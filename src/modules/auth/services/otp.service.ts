import {
  BadRequestException,
  HttpException,
  HttpStatus,
  Injectable,
  InternalServerErrorException,
  Logger,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as bcrypt from 'bcrypt';
import { createHmac, randomInt, randomUUID } from 'crypto';
import { RedisService } from '../../redis/redis.service';
import { OtpRecord } from '../entities/otp.entity';
import { OtpDeliveryService } from './otp-delivery.service';
import { VerificationType } from '../dto/register.dto';

const OTP_TTL_SECONDS = 5 * 60;
const OTP_MAX_ATTEMPTS = 5;
const OTP_LOCK_SECONDS = 15 * 60;
const OTP_REQUEST_LIMIT = 3;
const OTP_REQUEST_WINDOW_SECONDS = 60 * 60;
const OTP_RESEND_COOLDOWN_SECONDS = 30;
const PHONE_VERIFIED_TTL_SECONDS = 15 * 60;
const VERIFICATION_TOKEN_TTL_SECONDS = 10 * 60;
const VERIFY_OTP_FAILURE_SCRIPT = `
local otpKey = KEYS[1]
local attemptsKey = KEYS[2]
local lockKey = KEYS[3]
local maxAttempts = tonumber(ARGV[1])
local lockSeconds = tonumber(ARGV[2])
local nowMs = tonumber(ARGV[3])

if redis.call('EXISTS', lockKey) == 1 then
  return { "LOCKED", redis.call('PTTL', lockKey), redis.call('GET', lockKey) }
end

local otp = redis.call('GET', otpKey)
if not otp then
  return { "EXPIRED", 0, "" }
end

local decoded = cjson.decode(otp)
if tonumber(decoded.expiresAtEpochMs) <= nowMs then
  redis.call('DEL', otpKey)
  return { "EXPIRED", 0, "" }
end

local attempts = redis.call('INCR', attemptsKey)
redis.call('EXPIRE', attemptsKey, lockSeconds)

if attempts >= maxAttempts then
  local lockedUntil = nowMs + (lockSeconds * 1000)
  redis.call('SET', lockKey, tostring(lockedUntil), 'PX', lockSeconds * 1000)
  redis.call('DEL', otpKey)
  return { "LOCKED", lockSeconds * 1000, tostring(lockedUntil) }
end

return { "INCORRECT", maxAttempts - attempts, "" }
`;
const VERIFY_OTP_SUCCESS_SCRIPT = `
local otpKey = KEYS[1]
local attemptsKey = KEYS[2]
local verifiedKey = KEYS[3]
local verifiedTtl = tonumber(ARGV[1])

if redis.call('EXISTS', otpKey) == 0 then
  return 0
end

redis.call('DEL', otpKey)
redis.call('DEL', attemptsKey)
redis.call('SET', verifiedKey, '1', 'EX', verifiedTtl)
return 1
`;

@Injectable()
export class OtpService {
  private readonly logger = new Logger(OtpService.name);

  constructor(
    private readonly redisService: RedisService,
    private readonly config: ConfigService,
    private readonly delivery: OtpDeliveryService,
  ) {}

  async send(phone: string): Promise<{ expiresIn: number; resendAfter: number; otp?: string }> {
    const redis = this.redisService.client;
    const cooldownKey = this.cooldownKey(phone);
    const rateKey = this.rateKey(phone);
    const otpKey = this.otpKey(phone);
    const lockKey = this.lockKey(phone);

    const lockTtl = await redis.pttl(lockKey);
    if (lockTtl > 0) {
      this.logger.warn({
        event: 'otp.send.blocked_locked',
        phone: this.maskPhone(phone),
      });
      throw this.tooManyRequests({
        message: 'OTP verification is temporarily locked',
        lockedUntil: this.isoFromTtl(lockTtl),
      });
    }

    const cooldownSet = await redis.set(
      cooldownKey,
      '1',
      'EX',
      OTP_RESEND_COOLDOWN_SECONDS,
      'NX',
    );

    if (!cooldownSet) {
      const retryAfter = await redis.ttl(cooldownKey);
      this.logger.warn({
        event: 'otp.send.blocked_cooldown',
        phone: this.maskPhone(phone),
        retryAfter,
      });
      throw this.tooManyRequests({
        message: 'Please wait before requesting another OTP',
        retryAfter: Math.max(retryAfter, 1),
      });
    }

    const requests = await redis.incr(rateKey);
    if (requests === 1) {
      await redis.expire(rateKey, OTP_REQUEST_WINDOW_SECONDS);
    }

    if (requests > OTP_REQUEST_LIMIT) {
      await redis.del(cooldownKey);
      const retryAfter = await redis.ttl(rateKey);
      this.logger.warn({
        event: 'otp.send.blocked_rate_limit',
        phone: this.maskPhone(phone),
        retryAfter,
      });
      throw this.tooManyRequests({
        message: 'Hourly OTP request limit exceeded',
        retryAfter: Math.max(retryAfter, 1),
      });
    }

    const otp = String(randomInt(100000, 1000000));
    const codeHash = await bcrypt.hash(this.otpSecret(phone, otp), 10);
    const expiresAtEpochMs = Date.now() + OTP_TTL_SECONDS * 1000;
    const record: OtpRecord = {
      codeHash,
      expiresAt: new Date(expiresAtEpochMs).toISOString(),
    };

    await redis
      .multi()
      .set(
        otpKey,
        JSON.stringify({ ...record, expiresAtEpochMs }),
        'EX',
        OTP_TTL_SECONDS,
      )
      .del(this.attemptsKey(phone))
      .exec();
    await this.delivery.send(phone, otp);
    this.logger.log({ event: 'otp.send.success', phone: this.maskPhone(phone) });

    const response: { expiresIn: number; resendAfter: number; otp?: string } = {
      expiresIn: OTP_TTL_SECONDS,
      resendAfter: OTP_RESEND_COOLDOWN_SECONDS,
    };

    if (
      this.config.get<string>('NODE_ENV') !== 'production' &&
      this.config.get<string>('OTP_EXPOSE_IN_RESPONSE') === 'true'
    ) {
      response.otp = otp;
    }

    return response;
  }

  async verify(phone: string, otp: string): Promise<{ verificationToken: string }> {
    const redis = this.redisService.client;
    const otpKey = this.otpKey(phone);
    const attemptsKey = this.attemptsKey(phone);
    const lockKey = this.lockKey(phone);
    const verifiedKey = this.verifiedKey(phone);

    for (let i = 0; i < 3; i += 1) {
      await redis.watch(otpKey);
      const lockTtl = await redis.pttl(lockKey);
      if (lockTtl > 0) {
        await redis.unwatch();
        this.logger.warn({
          event: 'otp.verify.blocked_locked',
          phone: this.maskPhone(phone),
        });
        throw this.tooManyRequests({
          message: 'OTP verification is temporarily locked',
          lockedUntil: this.isoFromTtl(lockTtl),
        });
      }

      const record = await this.getOtpRecord(phone);
      if (!record) {
        await redis.unwatch();
        this.logger.warn({
          event: 'otp.verify.failed',
          reason: 'missing_or_expired',
          phone: this.maskPhone(phone),
        });
        throw new BadRequestException('OTP expired or not found');
      }

      if (new Date(record.expiresAt).getTime() <= Date.now()) {
        const tx = redis.multi();
        tx.del(otpKey);
        await tx.exec();
        this.logger.warn({
          event: 'otp.verify.failed',
          reason: 'expired',
          phone: this.maskPhone(phone),
        });
        throw new BadRequestException('OTP expired');
      }

      const matches = await bcrypt.compare(
        this.otpSecret(phone, otp),
        record.codeHash,
      );

      if (matches) {
        const result = await redis
          .multi()
          .eval(
            VERIFY_OTP_SUCCESS_SCRIPT,
            3,
            otpKey,
            attemptsKey,
            verifiedKey,
            PHONE_VERIFIED_TTL_SECONDS,
          )
          .exec();
        if (!result) {
          continue;
        }

        const scriptResult = result[0]?.[1];
        if (scriptResult === 1) {
          this.logger.log({
            event: 'verification_success',
            source: 'OTP',
            phone: this.maskPhone(phone),
          });
          const verificationToken = await this.createVerificationToken(
            phone,
            VerificationType.OTP,
          );
          return { verificationToken };
        }
        continue;
      }

      const result = await redis
        .multi()
        .eval(
          VERIFY_OTP_FAILURE_SCRIPT,
          3,
          otpKey,
          attemptsKey,
          lockKey,
          OTP_MAX_ATTEMPTS,
          OTP_LOCK_SECONDS,
          Date.now(),
        )
        .exec();
      if (!result) {
        continue;
      }

      const scriptResult = result[0]?.[1];
      if (!Array.isArray(scriptResult)) {
        throw new InternalServerErrorException('Unable to verify OTP');
      }

      const [status, value, lockedUntilEpochMs] = scriptResult;
      if (status === 'EXPIRED') {
        throw new BadRequestException('OTP expired');
      }

      if (status === 'LOCKED') {
        this.logger.warn({
          event: 'otp.verify.locked',
          phone: this.maskPhone(phone),
        });
        throw this.tooManyRequests({
          message: 'OTP verification is temporarily locked',
          lockedUntil: lockedUntilEpochMs
            ? new Date(Number(lockedUntilEpochMs)).toISOString()
            : this.isoFromTtl(Number(value)),
        });
      }

      this.logger.warn({
        event: 'verification_failed',
        source: 'OTP',
        reason: 'incorrect',
        phone: this.maskPhone(phone),
        attemptsRemaining: Number(value),
      });
      throw new BadRequestException({
        message: 'Incorrect OTP',
        attemptsRemaining: Number(value),
      });
    }

    throw new BadRequestException('Unable to verify OTP, please retry');
  }

  async createVerificationToken(
    phone: string,
    type: VerificationType,
  ): Promise<string> {
    const token = randomUUID();
    const tokenHash = this.verificationTokenHash(token);
    const key = this.verificationTokenKey(tokenHash);
    await this.redisService.client.set(
      key,
      JSON.stringify({ phone, type, createdAt: Date.now() }),
      'EX',
      VERIFICATION_TOKEN_TTL_SECONDS,
    );
    return token;
  }

  async consumeVerificationToken(token: string): Promise<string> {
    const tokenHash = this.verificationTokenHash(token);
    const key = this.verificationTokenKey(tokenHash);
    const raw = await this.redisService.client.get(key);
    if (!raw) {
      throw new BadRequestException('Invalid or expired verification token');
    }

    const payload = JSON.parse(raw) as {
      phone: string;
      type: VerificationType;
      createdAt: number;
    };
    await this.redisService.client.del(key);
    return payload.phone;
  }

  async consumePhoneVerification(phone: string): Promise<void> {
    const deleted = await this.redisService.client.del(this.verifiedKey(phone));
    if (!deleted) {
      throw new BadRequestException('Phone must be verified before registration');
    }
  }

  async assertPhoneVerified(phone: string): Promise<void> {
    const verified = await this.redisService.client.exists(this.verifiedKey(phone));
    if (!verified) {
      throw new BadRequestException('Phone must be verified before registration');
    }
  }

  private async getOtpRecord(phone: string): Promise<OtpRecord | null> {
    const raw = await this.redisService.client.get(this.otpKey(phone));
    return raw ? (JSON.parse(raw) as OtpRecord) : null;
  }

  private otpSecret(phone: string, otp: string): string {
    return `${phone}:${otp}:${this.config.getOrThrow<string>('OTP_PEPPER')}`;
  }

  private otpKey(phone: string): string {
    return `otp:${phone}`;
  }

  private attemptsKey(phone: string): string {
    return `otp:attempts:${phone}`;
  }

  private lockKey(phone: string): string {
    return `otp:lock:${phone}`;
  }

  private rateKey(phone: string): string {
    return `otp:rate:${phone}`;
  }

  private cooldownKey(phone: string): string {
    return `otp:cooldown:${phone}`;
  }

  private verifiedKey(phone: string): string {
    return `otp:verified:${phone}`;
  }

  private verificationTokenKey(tokenHash: string): string {
    return `verification:${tokenHash}`;
  }

  private verificationTokenHash(token: string): string {
    // Must be a distinct secret from OTP_PEPPER: OTP codes and verification
    // tokens protect different stages of the flow, so a leak of one pepper
    // must not compromise the other.
    const pepper = this.config.getOrThrow<string>('VERIFICATION_TOKEN_PEPPER');
    return createHmac('sha256', pepper).update(token).digest('hex');
  }

  private tooManyRequests(body: Record<string, unknown>): HttpException {
    return new HttpException(body, HttpStatus.TOO_MANY_REQUESTS);
  }

  private isoFromTtl(ttlMs: number): string {
    return new Date(Date.now() + Math.max(ttlMs, 0)).toISOString();
  }

  private maskPhone(phone: string): string {
    return `${phone.slice(0, 2)}******${phone.slice(-2)}`;
  }
}

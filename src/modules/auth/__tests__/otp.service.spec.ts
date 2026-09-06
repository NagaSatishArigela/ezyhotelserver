import { BadRequestException, HttpException, Logger } from '@nestjs/common';
import * as bcrypt from 'bcrypt';
import { createHmac } from 'crypto';
import { VerificationType } from '../dto/register.dto';
import { OtpService } from '../services/otp.service';

jest.mock('bcrypt', () => ({
  hash: jest.fn(),
  compare: jest.fn(),
}));

describe(OtpService.name, () => {
  beforeAll(() => {
    jest.spyOn(Logger.prototype, 'log').mockImplementation();
    jest.spyOn(Logger.prototype, 'warn').mockImplementation();
    jest.spyOn(Logger.prototype, 'error').mockImplementation();
  });

  const redis = {
    pttl: jest.fn(),
    set: jest.fn(),
    ttl: jest.fn(),
    incr: jest.fn(),
    expire: jest.fn(),
    del: jest.fn(),
    watch: jest.fn(),
    unwatch: jest.fn(),
    get: jest.fn(),
    exists: jest.fn(),
    multi: jest.fn(),
  };
  const redisService = { client: redis };
  const config = { get: jest.fn(), getOrThrow: jest.fn() };
  const delivery = { send: jest.fn() };
  let service: OtpService;

  beforeEach(() => {
    jest.clearAllMocks();
    jest.mocked(bcrypt.hash).mockResolvedValue('hashed-otp' as never);
    jest.mocked(bcrypt.compare).mockResolvedValue(false as never);
    service = new OtpService(redisService as never, config as never, delivery as never);
    config.get.mockReturnValue(undefined);
    config.getOrThrow.mockReturnValue('otp-pepper');
    redis.pttl.mockResolvedValue(-2);
    redis.set.mockResolvedValue('OK');
    redis.incr.mockResolvedValue(1);
    redis.expire.mockResolvedValue(1);
    redis.ttl.mockResolvedValue(30);
    redis.del.mockResolvedValue(1);
    redis.watch.mockResolvedValue('OK');
    redis.unwatch.mockResolvedValue('OK');
    redis.exists.mockResolvedValue(1);
    delivery.send.mockResolvedValue(undefined);
  });

  it('sends OTP successfully using required Redis keys', async () => {
    const multi = createMultiMock();
    redis.multi.mockReturnValue(multi);

    await expect(service.send('9876543210')).resolves.toEqual({
      expiresIn: 300,
      resendAfter: 30,
    });

    expect(redis.pttl).toHaveBeenCalledWith('otp:lock:9876543210');
    expect(redis.set).toHaveBeenCalledWith('otp:cooldown:9876543210', '1', 'EX', 30, 'NX');
    expect(redis.incr).toHaveBeenCalledWith('otp:rate:9876543210');
    expect(multi.set).toHaveBeenCalledWith(
      'otp:9876543210',
      expect.stringContaining('hashed-otp'),
      'EX',
      300,
    );
    expect(multi.del).toHaveBeenCalledWith('otp:attempts:9876543210');
    expect(delivery.send).toHaveBeenCalledWith('9876543210', expect.stringMatching(/^\d{6}$/));
  });

  it('returns the OTP only when explicitly enabled outside production', async () => {
    const multi = createMultiMock();
    redis.multi.mockReturnValue(multi);
    config.get.mockImplementation((key: string) => {
      if (key === 'NODE_ENV') return 'development';
      if (key === 'OTP_EXPOSE_IN_RESPONSE') return 'true';
      return undefined;
    });

    const result = await service.send('9876543210');

    expect(result.otp).toEqual(expect.stringMatching(/^\d{6}$/));
    expect(delivery.send).toHaveBeenCalledWith('9876543210', result.otp);
  });

  it('never returns the OTP when NODE_ENV is production', async () => {
    const multi = createMultiMock();
    redis.multi.mockReturnValue(multi);
    config.get.mockImplementation((key: string) => {
      if (key === 'NODE_ENV') return 'production';
      if (key === 'OTP_EXPOSE_IN_RESPONSE') return 'true';
      return undefined;
    });

    await expect(service.send('9876543210')).resolves.toEqual({
      expiresIn: 300,
      resendAfter: 30,
    });
  });

  it('enforces resend cooldown', async () => {
    redis.set.mockResolvedValue(null);
    redis.ttl.mockResolvedValue(20);

    await expect(service.send('9876543210')).rejects.toBeInstanceOf(HttpException);
    expect(redis.incr).not.toHaveBeenCalled();
  });

  it('enforces hourly rate limit', async () => {
    redis.incr.mockResolvedValue(4);
    redis.ttl.mockResolvedValue(3000);

    await expect(service.send('9876543210')).rejects.toBeInstanceOf(HttpException);
    expect(redis.del).toHaveBeenCalledWith('otp:cooldown:9876543210');
  });

  it('does not increment attempts when OTP is expired', async () => {
    const multi = createMultiMock();
    redis.multi.mockReturnValue(multi);
    redis.get.mockResolvedValue(
      JSON.stringify({
        codeHash: 'hashed-otp',
        expiresAt: new Date(Date.now() - 1000).toISOString(),
        expiresAtEpochMs: Date.now() - 1000,
      }),
    );

    await expect(service.verify('9876543210', '123456')).rejects.toBeInstanceOf(
      BadRequestException,
    );

    expect(multi.del).toHaveBeenCalledWith('otp:9876543210');
    expect(multi.eval).not.toHaveBeenCalled();
    expect(redis.incr).not.toHaveBeenCalled();
  });

  it('tracks wrong OTP attempts', async () => {
    const multi = createMultiMock([[null, ['INCORRECT', 4, '']]]);
    redis.multi.mockReturnValue(multi);
    redis.get.mockResolvedValue(validOtpRecord());

    await expect(service.verify('9876543210', '111111')).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(multi.eval).toHaveBeenCalledWith(
      expect.any(String),
      3,
      'otp:9876543210',
      'otp:attempts:9876543210',
      'otp:lock:9876543210',
      5,
      900,
      expect.any(Number),
    );
  });

  it('locks after max wrong OTP attempts', async () => {
    const lockedUntil = String(Date.now() + 900000);
    const multi = createMultiMock([[null, ['LOCKED', 900000, lockedUntil]]]);
    redis.multi.mockReturnValue(multi);
    redis.get.mockResolvedValue(validOtpRecord());

    await expect(service.verify('9876543210', '111111')).rejects.toBeInstanceOf(
      HttpException,
    );
  });

  it('marks phone verified on correct OTP', async () => {
    const multi = createMultiMock([[null, 1]]);
    redis.multi.mockReturnValue(multi);
    redis.get.mockResolvedValue(validOtpRecord());
    jest.mocked(bcrypt.compare).mockResolvedValue(true as never);

    await expect(service.verify('9876543210', '123456')).resolves.toEqual({
      verificationToken: expect.any(String),
    });

    expect(multi.eval).toHaveBeenCalledWith(
      expect.any(String),
      3,
      'otp:9876543210',
      'otp:attempts:9876543210',
      'otp:verified:9876543210',
      900,
    );
  });

  it('stores a hashed verification token in Redis with the expected prefixed key', async () => {
    const token = await service.createVerificationToken('9876543210', VerificationType.OTP);
    const expectedHash = createHmac('sha256', 'otp-pepper').update(token).digest('hex');

    expect(token).toMatch(/[0-9a-fA-F-]{36}/);
    expect(redis.set).toHaveBeenCalledWith(
      `verification:${expectedHash}`,
      expect.stringContaining('"phone":"9876543210"'),
      'EX',
      600,
    );
  });

  it('consumes a hashed verification token and removes it from Redis', async () => {
    const token = 'test-token-uuid-0000';
    const expectedHash = createHmac('sha256', 'otp-pepper').update(token).digest('hex');
    redis.get.mockResolvedValue(
      JSON.stringify({
        phone: '9876543210',
        type: 'OTP',
      }),
    );

    await expect(service.consumeVerificationToken(token)).resolves.toEqual('9876543210');
    expect(redis.get).toHaveBeenCalledWith(`verification:${expectedHash}`);
    expect(redis.del).toHaveBeenCalledWith(`verification:${expectedHash}`);
  });
});

function validOtpRecord(): string {
  return JSON.stringify({
    codeHash: 'hashed-otp',
    expiresAt: new Date(Date.now() + 300000).toISOString(),
    expiresAtEpochMs: Date.now() + 300000,
  });
}

function createMultiMock(execResult: unknown = [[null, 'OK']]) {
  return {
    set: jest.fn().mockReturnThis(),
    del: jest.fn().mockReturnThis(),
    eval: jest.fn().mockReturnThis(),
    exec: jest.fn().mockResolvedValue(execResult),
  };
}

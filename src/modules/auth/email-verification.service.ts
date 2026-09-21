import { BadRequestException, Injectable, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHash, randomBytes } from 'crypto';
import { PrismaService } from '../database/prisma.service';
import { RedisService } from '../redis/redis.service';
@Injectable()
export class EmailVerificationService {
  constructor(private readonly prisma: PrismaService, private readonly redis: RedisService, private readonly config: ConfigService) {}
  private key(token: string) { return 'email-verification:' + createHash('sha256').update(token).digest('hex'); }
  async request(userId: string) {
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: userId } });
    if (user.isEmailVerified) return { verified: true };
    const url = this.config.get<string>('EMAIL_GATEWAY_URL');
    const secret = this.config.get<string>('EMAIL_GATEWAY_API_KEY');
    if (!url || !secret) throw new ServiceUnavailableException('Email verification delivery is not configured');
    const token = randomBytes(32).toString('hex');
    const key = this.key(token);
    await this.redis.client.set(key, JSON.stringify({ userId, email: user.email }), 'EX', 900);
    try {
      const response = await fetch(url, { method: 'POST', headers: { Authorization: 'Bearer ' + secret, 'Content-Type': 'application/json' },
        body: JSON.stringify({ to: user.email, templateId: 'email_verification', data: { code: token, expiresInMinutes: 15 } }), signal: AbortSignal.timeout(10000) });
      if (!response.ok) throw new Error('Delivery failed');
    } catch {
      await this.redis.client.del(key);
      throw new ServiceUnavailableException('Unable to send verification email. Please retry.');
    }
    return { verified: false, expiresIn: 900 };
  }
  async confirm(userId: string, token: string) {
    const key = this.key(token);
    const raw = await this.redis.client.get(key);
    if (!raw) throw new BadRequestException('Verification code is invalid or expired');
    const pending = JSON.parse(raw) as { userId: string; email: string };
    if (pending.userId !== userId) throw new BadRequestException('Sign in to the account that requested this code');
    // Atomic consume prevents replay. A token is never returned by the request API.
    if (!(await this.redis.client.getdel(key))) throw new BadRequestException('Verification code already used');
    const result = await this.prisma.user.updateMany({ where: { id: userId, email: pending.email, status: 'active' }, data: { isEmailVerified: true } });
    if (!result.count) throw new BadRequestException('Account changed. Request a new verification email');
    return { verified: true };
  }
}

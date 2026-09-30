import { INestApplication } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import request from 'supertest';
import { AuthController } from '../controllers/auth.controller';
import { AuthService } from '../services/auth.service';

describe('refresh endpoint rate limits', () => {
  let app: INestApplication;
  const refreshToken = jest.fn().mockResolvedValue({ accessToken: 'new-access', refreshToken: 'new-refresh' });
  beforeEach(async () => {
    refreshToken.mockClear();
    const module = await Test.createTestingModule({
      imports: [ThrottlerModule.forRoot([
        { name: 'default', ttl: 60_000, limit: 200 },
        { name: 'strict', ttl: 60_000, limit: 10 },
        { name: 'upload', ttl: 3_600_000, limit: 20 },
      ])],
      controllers: [AuthController],
      providers: [
        { provide: AuthService, useValue: { refreshToken } },
        { provide: APP_GUARD, useClass: ThrottlerGuard },
      ],
    }).compile();
    app = module.createNestApplication();
    await app.init();
    jest.useFakeTimers({ doNotFake: ['nextTick', 'setImmediate'] });
  });
  afterEach(async () => { await app?.close(); jest.useRealTimers(); });

  it('allows ongoing renewals beyond 20 per hour without applying the upload bucket', async () => {
    for (let index = 0; index < 25; index++) {
      if (index > 0 && index % 5 === 0) await jest.advanceTimersByTimeAsync(61000);
      const result = await request(app.getHttpServer()).post('/auth/refresh-token')
        .send({ refreshToken: 'test-refresh-token' }).expect(201);
      expect(result.headers['x-ratelimit-limit-upload']).toBeUndefined();
      expect(result.body.accessToken).toBe('new-access');
    }
    expect(refreshToken).toHaveBeenCalledTimes(25);
  });

  it('still rejects excessive per-minute renewals and accepts them after the cooldown', async () => {
    for (let index = 0; index < 5; index++) {
      await request(app.getHttpServer()).post('/auth/refresh-token')
        .send({ refreshToken: 'test-refresh-token' }).expect(201);
    }
    const limited = await request(app.getHttpServer()).post('/auth/refresh-token')
      .send({ refreshToken: 'test-refresh-token' }).expect(429);
    expect(Number(limited.headers['retry-after'])).toBeGreaterThan(0);
    expect(refreshToken).toHaveBeenCalledTimes(5);
    await jest.advanceTimersByTimeAsync(61000);
    await request(app.getHttpServer()).post('/auth/refresh-token')
      .send({ refreshToken: 'test-refresh-token' }).expect(201);
  });
});

import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { PrismaService } from '../src/modules/database/prisma.service';
import { createTestApp } from './utils/test-app';
import { resetDatabase } from './utils/reset-database';

/**
 * Smoke test for the e2e harness itself: boots the full Nest application
 * against the test database (`.env.test`) and exercises the public auth
 * endpoints. Requires the test database to be migrated:
 *
 *   npm run prisma:migrate:test
 *   npm run test:e2e
 */
describe('Auth (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;

  beforeAll(async () => {
    const harness = await createTestApp();
    app = harness.app;
    prisma = app.get(PrismaService);
  });

  afterAll(async () => {
    await app?.close();
  });

  beforeEach(async () => {
    await resetDatabase(prisma);
  });

  it('rejects an invalid phone number on send-otp', async () => {
    await request(app.getHttpServer())
      .post('/auth/send-otp')
      .send({ phone: '12345' })
      .expect(400);
  });

  it('returns a 401 for login with unknown credentials without leaking which field is wrong', async () => {
    const response = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email: 'nobody@ezyhotels.in', password: 'WrongPass@123' })
      .expect(401);

    expect(response.body.error.message).not.toMatch(/user/i);
  });

  it('rejects a malformed verification token on register', async () => {
    await request(app.getHttpServer())
      .post('/auth/register')
      .send({
        verificationToken: 'not-a-uuid',
        email: 'guest@ezyhotels.in',
        password: 'EzyHotels@123',
      })
      .expect(400);
  });
});

import { INestApplication } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { GlobalRole, User, UserStatus } from '@prisma/client';
import request from 'supertest';
import { PrismaService } from '../src/modules/database/prisma.service';
import { createTestApp } from './utils/test-app';
import { resetDatabase } from './utils/reset-database';

/**
 * E2E for the support system: any user can raise/track tickets; the agent
 * tooling (queue/detail/resolve/escalate/user-lookup) is restricted to the
 * SUPPORT role (and admins). Requires: npm run prisma:migrate:test
 */
describe('Support (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let jwt: JwtService;
  let config: ConfigService;
  let phone = 9200000000;

  beforeAll(async () => {
    const harness = await createTestApp();
    app = harness.app;
    prisma = app.get(PrismaService);
    jwt = app.get(JwtService);
    config = app.get(ConfigService);
  });
  afterAll(async () => { await app?.close(); });
  beforeEach(async () => { await resetDatabase(prisma); phone = 9200000000; });

  async function createUser(role: GlobalRole = GlobalRole.USER): Promise<User> {
    phone += 1;
    return prisma.user.create({
      data: {
        phone: String(phone), email: `u${phone}@quicknest.test`, passwordHash: 'x',
        globalRole: role, status: UserStatus.active, isPhoneVerified: true, isEmailVerified: true,
      },
    });
  }
  function tokenFor(u: User): Promise<string> {
    return jwt.signAsync(
      { id: u.id, phone: u.phone, globalRole: u.globalRole, sessionId: 'e2e' },
      { secret: config.getOrThrow<string>('JWT_ACCESS_SECRET'), expiresIn: 900, algorithm: 'HS256' },
    );
  }
  const srv = () => app.getHttpServer();

  it('user raises + tracks a ticket; support agent resolves it; user lookup works', async () => {
    const user = await createUser();
    const userToken = await tokenFor(user);
    const agent = await createUser(GlobalRole.SUPPORT);
    const agentToken = await tokenFor(agent);

    // User raises a ticket
    const created = await request(srv())
      .post('/support/tickets').set('Authorization', `Bearer ${userToken}`)
      .send({ subject: 'Cannot check in', description: 'The QR code at the hotel did not scan.', category: 'Bookings' })
      .expect(201);
    const ticketId = created.body.id;
    expect(created.body.status).toBe('open');

    // User sees it in their own tickets
    const mine = await request(srv()).get('/support/my-tickets').set('Authorization', `Bearer ${userToken}`).expect(200);
    expect(mine.body.items.some((t: { id: string }) => t.id === ticketId)).toBe(true);

    // Agent queue contains it
    const queue = await request(srv()).get('/support/tickets?status=open').set('Authorization', `Bearer ${agentToken}`).expect(200);
    expect(queue.body.items.some((t: { id: string }) => t.id === ticketId)).toBe(true);

    // Agent resolves it
    const resolved = await request(srv())
      .post(`/support/tickets/${ticketId}/resolve`).set('Authorization', `Bearer ${agentToken}`)
      .send({ resolutionNote: 'Reissued the QR; guest checked in.' }).expect(201);
    expect(resolved.body.status).toBe('resolved');
    expect(resolved.body.assignedToUserId).toBe(agent.id);

    // Agent user-lookup finds the ticket's raiser (safe fields only)
    const lookup = await request(srv())
      .get(`/support/users/lookup?q=${encodeURIComponent(user.email.slice(0, 8))}`)
      .set('Authorization', `Bearer ${agentToken}`).expect(200);
    expect(Array.isArray(lookup.body)).toBe(true);
    expect(lookup.body[0]).not.toHaveProperty('passwordHash');
  });

  it('a non-support user cannot reach the agent queue (403)', async () => {
    const user = await createUser();
    const userToken = await tokenFor(user);
    await request(srv()).get('/support/tickets').set('Authorization', `Bearer ${userToken}`).expect(403);
    await request(srv()).get('/support/users/lookup?q=abc').set('Authorization', `Bearer ${userToken}`).expect(403);
  });

  it('rejects an unauthenticated ticket creation (401)', async () => {
    await request(srv()).post('/support/tickets').send({ subject: 'x', description: 'y' }).expect(401);
  });
});

import 'reflect-metadata';
import { JwtStrategy } from '../strategies/jwt.strategy';
import { HotelTeamService } from '../hotel-team.service';
import { EmailVerificationService } from '../email-verification.service';
import { FinanceModule } from '../../finance/finance.module';
import { PAYMENT_GATEWAY } from '../../finance/gateway/payment-gateway.interface';
import { DisabledPaymentGateway } from '../../finance/gateway/disabled-payment-gateway';
import { SandboxPaymentGateway } from '../../finance/gateway/sandbox-payment-gateway';

describe('session revocation', () => {
  const user = { id: 'u', status: 'active', globalRole: 'USER' };
  const live = { userId: 'u', revokedAt: null, expiresAt: new Date(Date.now() + 60000) };
  const check = (session: unknown, payload = { id: 'u', sessionId: 's', globalRole: 'USER' }) => new JwtStrategy({ getOrThrow: () => 'test-secret' } as never,
    { findById: async () => user, findSessionById: async () => session } as never).validate(payload as never);
  it('accepts an active session', async () => { await expect(check(live)).resolves.toMatchObject({ id: 'u' }); });
  it.each([null, { ...live, revokedAt: new Date() }, { ...live, userId: 'other' }, { ...live, expiresAt: new Date(0) }])('rejects invalid session %#', async session => { await expect(check(session)).rejects.toThrow(); });
  it('rejects legacy tokens without session IDs', async () => { await expect(check(live, { id: 'u', sessionId: '', globalRole: 'USER' })).rejects.toThrow(); });
});
describe('production payment gate', () => {
  const factory = Reflect.getMetadata('providers', FinanceModule).find((p: { provide?: unknown }) => p.provide === PAYMENT_GATEWAY).useFactory;
  it.each([undefined, 'sandbox', 'disabled'])('disables production checkout for %s', async provider => {
    const gateway = factory({ get: (key: string) => ({ NODE_ENV: 'production', PAYMENT_PROVIDER: provider })[key as 'NODE_ENV'] });
    expect(gateway).toBeInstanceOf(DisabledPaymentGateway);
    await expect(gateway.createOrder({})).rejects.toThrow('not available');
    expect(() => gateway.verifyPaymentSignature({})).toThrow('not available');
  });
  it('retains sandbox for local/test environments', () => { expect(factory({ get: () => undefined })).toBeInstanceOf(SandboxPaymentGateway); });
});
it('requires verified email and makes no assignment when no verified account exists', async () => {
  const prisma = { property: { findUniqueOrThrow: jest.fn().mockResolvedValue({ status: 'approved', ownerId: 'owner' }) }, user: { findFirst: jest.fn().mockResolvedValue(null) }, userPropertyRole: { upsert: jest.fn() } };
  const service = new HotelTeamService(prisma as never, { authorize: async () => undefined } as never);
  await expect(service.assign({ id: 'owner', globalRole: 'USER' } as never, 'p', { email: 'staff@example.test', role: 'MANAGER' })).rejects.toThrow('verified email');
  expect(prisma.user.findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ isEmailVerified: true }) }));
  expect(prisma.userPropertyRole.upsert).not.toHaveBeenCalled();
});
describe('email ownership', () => {
  const code = 'a'.repeat(64);
  const prisma = { user: { findUniqueOrThrow: jest.fn(), updateMany: jest.fn() } };
  const redis = { client: { get: jest.fn(), getdel: jest.fn(), set: jest.fn(), del: jest.fn() } };
  const service = new EmailVerificationService(prisma as never, redis as never, { get: () => undefined } as never);
  beforeEach(() => { jest.clearAllMocks(); });
  it('does not verify without configured delivery', async () => {
    prisma.user.findUniqueOrThrow.mockResolvedValue({ email: 'test@example.test', isEmailVerified: false });
    await expect(service.request('u')).rejects.toThrow('not configured');
    expect(prisma.user.updateMany).not.toHaveBeenCalled();
  });
  it('rejects expired codes', async () => { redis.client.get.mockResolvedValue(null); await expect(service.confirm('u', code)).rejects.toThrow('expired'); });
  it('does not consume another account code', async () => {
    redis.client.get.mockResolvedValue(JSON.stringify({ userId: 'other', email: 'test@example.test' }));
    await expect(service.confirm('u', code)).rejects.toThrow('account');
    expect(redis.client.getdel).not.toHaveBeenCalled();
  });
  it('rejects a replay after atomic consumption', async () => {
    redis.client.get.mockResolvedValue(JSON.stringify({ userId: 'u', email: 'test@example.test' }));
    redis.client.getdel.mockResolvedValue(null);
    await expect(service.confirm('u', code)).rejects.toThrow('already used');
  });
  it('verifies only the same active account and original email', async () => {
    const pending = JSON.stringify({ userId: 'u', email: 'test@example.test' });
    redis.client.get.mockResolvedValue(pending); redis.client.getdel.mockResolvedValue(pending); prisma.user.updateMany.mockResolvedValue({ count: 1 });
    await expect(service.confirm('u', code)).resolves.toEqual({ verified: true });
    expect(prisma.user.updateMany).toHaveBeenCalledWith({ where: { id: 'u', email: 'test@example.test', status: 'active' }, data: { isEmailVerified: true } });
  });
});

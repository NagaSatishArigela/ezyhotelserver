import 'reflect-metadata';
import { Reflector } from '@nestjs/core';
import { RolesGuard } from '../guards/roles.guard';
import { GlobalRole } from '../entities/user.entity';
import { SupportAgentController } from '../../support/support.controller';
import { JwtStrategy } from '../strategies/jwt.strategy';

const reflector = new Reflector();
function context(globalRole: GlobalRole, controller: unknown = SupportAgentController) {
  return { getHandler: () => SupportAgentController.prototype.queue, getClass: () => controller,
    switchToHttp: () => ({ getRequest: () => ({ user: { id: 'account', globalRole } }) }) } as never;
}
it('denies hotel/customer accounts access to support tooling', () => {
  expect(() => new RolesGuard(reflector).canActivate(context(GlobalRole.USER))).toThrow('Insufficient role');
});
it.each([GlobalRole.SUPPORT, GlobalRole.ADMIN, GlobalRole.SUPER_ADMIN])('permits authorized %s support operations without changing identity', role => {
  expect(new RolesGuard(reflector).canActivate(context(role))).toBe(true);
});
it.each([GlobalRole.SUPPORT, GlobalRole.ADMIN, GlobalRole.USER])('denies %s super admin-only operations', role => {
  const guard = new RolesGuard({ getAllAndOverride: () => [GlobalRole.SUPER_ADMIN] } as never);
  expect(() => guard.canActivate(context(role))).toThrow('Insufficient role');
});
it('uses the database role rather than a stale privileged token claim', async () => {
  const strategy = new JwtStrategy({ getOrThrow: () => 'test-secret' } as never, {
    findById: async () => ({ id: 'account', status: 'active', globalRole: GlobalRole.SUPPORT }),
    findSessionById: async () => ({ userId: 'account', revokedAt: null, expiresAt: new Date(Date.now() + 60000) }),
  } as never);
  await expect(strategy.validate({ id: 'account', globalRole: GlobalRole.SUPER_ADMIN, sessionId: 'session' }))
    .resolves.toEqual({ id: 'account', globalRole: GlobalRole.SUPPORT, sessionId: 'session' });
});

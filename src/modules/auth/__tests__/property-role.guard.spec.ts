import { BadRequestException, ExecutionContext, ForbiddenException } from '@nestjs/common';
import { PropertyRoleGuard } from '../guards/property-role.guard';
import { PROPERTY_PERMISSION_KEY, APPLICATION_ACCESS_KEY } from '../property-permissions';
const propertyId = '11111111-1111-4111-8111-111111111111';
describe(PropertyRoleGuard.name, () => {
  const access = { authorize: jest.fn() };
  const reflector = { getAllAndOverride: jest.fn() };
  const guard = new PropertyRoleGuard(reflector as never, access as never);
  const user = { id: 'user', globalRole: 'USER' };
  function context(request: Record<string, unknown>): ExecutionContext {
    return { getHandler: () => guard.canActivate, getClass: () => PropertyRoleGuard, switchToHttp: () => ({ getRequest: () => ({ user, ...request }) }) } as unknown as ExecutionContext;
  }
  beforeEach(() => { jest.resetAllMocks(); reflector.getAllAndOverride.mockImplementation(key => key === PROPERTY_PERMISSION_KEY ? 'view_bookings' : undefined); });
  it('delegates the authenticated user and property permission', async () => {
    await expect(guard.canActivate(context({ params: { propertyId } }))).resolves.toBe(true);
    expect(access.authorize).toHaveBeenCalledWith(user, propertyId, 'view_bookings', false, []);
  });
  it.each([undefined, 'invalid', ['invalid']])('rejects invalid property context %s', async id => {
    await expect(guard.canActivate(context({ params: { propertyId: id } }))).rejects.toThrow(BadRequestException);
    expect(access.authorize).not.toHaveBeenCalled();
  });
  it('propagates authorization denial', async () => {
    access.authorize.mockRejectedValue(new ForbiddenException());
    await expect(guard.canActivate(context({ query: { propertyId } }))).rejects.toThrow(ForbiddenException);
  });
  it('passes application access separately from operational permissions', async () => {
    reflector.getAllAndOverride.mockImplementation(key => key === APPLICATION_ACCESS_KEY ? true : undefined);
    await guard.canActivate(context({ body: { propertyId } }));
    expect(access.authorize).toHaveBeenCalledWith(user, propertyId, undefined, true, []);
  });
  it('does not enforce metadata-free endpoints', async () => {
    reflector.getAllAndOverride.mockReturnValue(undefined);
    await expect(guard.canActivate(context({}))).resolves.toBe(true);
    expect(access.authorize).not.toHaveBeenCalled();
  });
});

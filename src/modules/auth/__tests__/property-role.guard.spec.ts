import { BadRequestException, ExecutionContext, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { GlobalRole, PropertyRole } from '@prisma/client';
import { PropertyRoleGuard } from '../guards/property-role.guard';

describe(PropertyRoleGuard.name, () => {
  const reflector = { getAllAndOverride: jest.fn() };
  const users = { hasPropertyRole: jest.fn() };
  const handler = jest.fn();
  const guard = new PropertyRoleGuard(
    reflector as unknown as Reflector,
    users as never,
  );

  beforeEach(() => {
    jest.clearAllMocks();
    reflector.getAllAndOverride.mockReturnValue([PropertyRole.MANAGER]);
  });

  it('allows a manager on the requested property', async () => {
    users.hasPropertyRole.mockResolvedValue(true);

    await expect(
      guard.canActivate(
        context({
          user: {
            id: 'user-1',
            phone: '9876543210',
            globalRole: GlobalRole.USER,
          },
          params: { propertyId: 'property-1' },
        }),
      ),
    ).resolves.toBe(true);
    expect(users.hasPropertyRole).toHaveBeenCalledWith('user-1', 'property-1', [
      PropertyRole.MANAGER,
    ]);
  });

  it('denies a manager accessing another property', async () => {
    users.hasPropertyRole.mockResolvedValue(false);

    await expect(
      guard.canActivate(
        context({
          user: {
            id: 'user-1',
            phone: '9876543210',
            globalRole: GlobalRole.USER,
          },
          params: { propertyId: 'property-2' },
        }),
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('allows an owner on own property', async () => {
    reflector.getAllAndOverride.mockReturnValue([PropertyRole.OWNER]);
    users.hasPropertyRole.mockResolvedValue(true);

    await expect(
      guard.canActivate(
        context({
          user: {
            id: 'owner-1',
            phone: '9876543210',
            globalRole: GlobalRole.USER,
          },
          body: { propertyId: 'property-1' },
        }),
      ),
    ).resolves.toBe(true);
    expect(users.hasPropertyRole).toHaveBeenCalledWith('owner-1', 'property-1', [
      PropertyRole.OWNER,
    ]);
  });

  it('throws BadRequestException when propertyId is missing', async () => {
    await expect(
      guard.canActivate(
        context({
          user: {
            id: 'user-1',
            phone: '9876543210',
            globalRole: GlobalRole.USER,
          },
        }),
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('allows global admins without property lookup', async () => {
    await expect(
      guard.canActivate(
        context({
          user: {
            id: 'admin-1',
            phone: '9876543210',
            globalRole: GlobalRole.ADMIN,
          },
        }),
      ),
    ).resolves.toBe(true);
    expect(users.hasPropertyRole).not.toHaveBeenCalled();
  });

  function context(request: Record<string, unknown>): ExecutionContext {
    return {
      getHandler: () => handler,
      getClass: () => PropertyRoleGuard,
      switchToHttp: () => ({
        getRequest: () => ({
          params: {},
          query: {},
          body: {},
          ...request,
        }),
      }),
    } as unknown as ExecutionContext;
  }
});

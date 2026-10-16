import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { GlobalRole } from '@prisma/client';
import { PropertyAccessService } from '../property-access.service';
describe(PropertyAccessService.name, () => {
  const prisma = {
    property: { findUnique: jest.fn(), findMany: jest.fn() },
    userPropertyRole: { findUnique: jest.fn(), findMany: jest.fn() },
  };
  const service = new PropertyAccessService(prisma as never);
  const user = { id: 'owner', globalRole: GlobalRole.USER };
  const property = {
    id: 'hotel',
    ownerId: 'owner',
    status: 'approved',
    name: 'Hotel',
    isActive: true,
  };
  const member = { userId: 'owner', propertyId: 'hotel', role: 'OWNER', hotelRole: null };
  beforeEach(() => {
    jest.resetAllMocks();
    prisma.property.findUnique.mockResolvedValue(property);
    prisma.userPropertyRole.findUnique.mockResolvedValue(member);
  });
  it.each(['draft', 'pending_review', 'needs_revision', 'rejected', 'suspended'])(
    'denies operational access for %s even with old OWNER membership',
    async (status) => {
      prisma.property.findUnique.mockResolvedValue({ ...property, status });
      await expect(service.authorize(user, 'hotel', 'manage_staff')).rejects.toThrow(
        ForbiddenException,
      );
      await expect(service.authorize(user, 'hotel', undefined, true)).resolves.toBeUndefined();
    },
  );
  it('denies applicants operational access without membership', async () => {
    prisma.userPropertyRole.findUnique.mockResolvedValue(null);
    await expect(service.authorize(user, 'hotel', 'view_bookings')).rejects.toThrow(
      ForbiddenException,
    );
  });
  it('denies a foreign applicant', async () => {
    await expect(
      service.authorize({ ...user, id: 'stranger' }, 'hotel', undefined, true),
    ).rejects.toThrow(ForbiddenException);
  });
  it('allows canonical approved owner team management', async () => {
    await expect(service.authorize(user, 'hotel', 'manage_staff')).resolves.toBeUndefined();
  });
  it('does not trust an OWNER membership for another owner', async () => {
    prisma.userPropertyRole.findUnique.mockResolvedValue({ ...member, userId: 'stranger' });
    await expect(
      service.authorize({ ...user, id: 'stranger' }, 'hotel', 'manage_staff'),
    ).rejects.toThrow(ForbiddenException);
  });
  it('allows staff availability reads but denies inventory writes', async () => {
    prisma.userPropertyRole.findUnique.mockResolvedValue({ ...member, role: 'STAFF' });
    await expect(
      service.authorize(user, 'hotel', ['manage_rooms', 'view_availability']),
    ).resolves.toBeUndefined();
    await expect(service.authorize(user, 'hotel', 'manage_rooms')).rejects.toThrow(
      ForbiddenException,
    );
    await expect(service.authorize(user, 'hotel', 'manage_staff')).rejects.toThrow(
      ForbiddenException,
    );
  });
  it('rejects a custom role belonging to another property', async () => {
    prisma.userPropertyRole.findUnique.mockResolvedValue({
      ...member,
      role: 'STAFF',
      hotelRole: { propertyId: 'other', permissions: ['view_bookings'] },
    });
    await expect(service.authorize(user, 'hotel', 'view_bookings')).rejects.toThrow(
      ForbiddenException,
    );
  });
  it('uses custom permissions without falling back to standard ones', async () => {
    prisma.userPropertyRole.findUnique.mockResolvedValue({
      ...member,
      role: 'MANAGER',
      hotelRole: { propertyId: 'hotel', permissions: ['view_bookings', 'manage_staff'] },
    });
    await expect(service.authorize(user, 'hotel', 'view_bookings')).resolves.toBeUndefined();
    await expect(service.authorize(user, 'hotel', 'manage_rooms')).rejects.toThrow(
      ForbiddenException,
    );
    await expect(service.authorize(user, 'hotel', 'manage_staff')).rejects.toThrow(
      ForbiddenException,
    );
  });
  it.each([GlobalRole.ADMIN, GlobalRole.SUPER_ADMIN])(
    'allows platform %s without hotel membership',
    async (globalRole) => {
      prisma.userPropertyRole.findUnique.mockResolvedValue(null);
      await expect(
        service.authorize({ id: 'platform', globalRole }, 'hotel', 'manage_staff'),
      ).resolves.toBeUndefined();
    },
  );
  it('rejects a nonexistent property even for platform administrators', async () => {
    prisma.property.findUnique.mockResolvedValue(null);
    await expect(
      service.authorize({ ...user, globalRole: GlobalRole.SUPER_ADMIN }, 'missing', 'manage_staff'),
    ).rejects.toThrow(NotFoundException);
  });
  it('reports pending applications without roles or operational permissions', async () => {
    prisma.userPropertyRole.findMany.mockResolvedValue([member]);
    prisma.property.findMany.mockResolvedValue([{ ...property, status: 'pending_review' }]);
    expect(await service.memberships('owner')).toEqual([
      expect.objectContaining({ role: null, permissions: [], isApplicant: true }),
    ]);
  });
});

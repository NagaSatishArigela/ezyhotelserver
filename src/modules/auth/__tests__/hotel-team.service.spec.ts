import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { GlobalRole } from '@prisma/client';
import { HotelTeamService } from '../hotel-team.service';
import { AssignMemberDto, SaveHotelRoleDto } from '../hotel-team.dto';
import { validate } from 'class-validator';
describe(HotelTeamService.name, () => {
  const prisma = {
    property: { findUniqueOrThrow: jest.fn() },
    user: { findFirst: jest.fn() },
    hotelRole: {
      findFirst: jest.fn(),
      create: jest.fn(),
      updateMany: jest.fn(),
      deleteMany: jest.fn(),
    },
    userPropertyRole: { upsert: jest.fn(), deleteMany: jest.fn() },
  };
  const access = { authorize: jest.fn() };
  const service = new HotelTeamService(prisma as never, access as never);
  const user = { id: 'owner', phone: '', globalRole: GlobalRole.USER };
  beforeEach(() => {
    jest.resetAllMocks();
    prisma.property.findUniqueOrThrow.mockResolvedValue({ ownerId: 'owner', status: 'approved' });
    prisma.user.findFirst.mockResolvedValue({ id: 'staff' });
    prisma.hotelRole.findFirst.mockResolvedValue({ id: 'custom', propertyId: 'hotel' });
  });
  it('requires owner/team permission before reading target accounts', async () => {
    access.authorize.mockRejectedValue(new ForbiddenException());
    await expect(
      service.assign(user, 'hotel', { email: 'staff@test.com', role: 'STAFF' }),
    ).rejects.toThrow(ForbiddenException);
    expect(prisma.user.findFirst).not.toHaveBeenCalled();
  });
  it('rejects team operations on unapproved hotels even for platform users', async () => {
    prisma.property.findUniqueOrThrow.mockResolvedValue({ status: 'pending_review' });
    await expect(
      service.assign({ ...user, globalRole: GlobalRole.SUPER_ADMIN }, 'hotel', {
        email: 'staff@test.com',
        role: 'STAFF',
      }),
    ).rejects.toThrow(ForbiddenException);
  });
  it('assigns hotel admin without changing the global user role', async () => {
    await service.assign(user, 'hotel', { email: 'staff@test.com', role: 'HOTEL_ADMIN' });
    expect(prisma.user.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ globalRole: 'USER', status: 'active' }),
      }),
    );
    expect(prisma.userPropertyRole.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { userId_propertyId: { userId: 'staff', propertyId: 'hotel' } },
        update: { role: 'HOTEL_ADMIN', hotelRoleId: null },
      }),
    );
  });
  it('rejects custom roles from another property', async () => {
    prisma.hotelRole.findFirst.mockResolvedValue(null);
    await expect(
      service.assign(user, 'hotel', { email: 'staff@test.com', hotelRoleId: 'foreign' }),
    ).rejects.toThrow(NotFoundException);
    expect(prisma.hotelRole.findFirst).toHaveBeenCalledWith({
      where: { id: 'foreign', propertyId: 'hotel' },
    });
    expect(prisma.userPropertyRole.upsert).not.toHaveBeenCalled();
  });
  it('rejects ambiguous role assignments', async () => {
    await expect(
      service.assign(user, 'hotel', {
        email: 'staff@test.com',
        role: 'STAFF',
        hotelRoleId: 'custom',
      }),
    ).rejects.toThrow(BadRequestException);
  });
  it('cannot demote or remove the canonical owner', async () => {
    prisma.user.findFirst.mockResolvedValue({ id: 'owner' });
    await expect(
      service.assign(user, 'hotel', { email: 'owner@test.com', role: 'STAFF' }),
    ).rejects.toThrow(ForbiddenException);
    await expect(service.removeMember(user, 'hotel', 'owner')).rejects.toThrow(ForbiddenException);
    expect(prisma.userPropertyRole.deleteMany).not.toHaveBeenCalled();
  });
  it('constrains member deletion to the selected property and excludes owners', async () => {
    prisma.userPropertyRole.deleteMany.mockResolvedValue({ count: 1 });
    await service.removeMember(user, 'hotel', 'staff');
    expect(prisma.userPropertyRole.deleteMany).toHaveBeenCalledWith({
      where: { propertyId: 'hotel', userId: 'staff', role: { not: 'OWNER' } },
    });
  });
  it('refuses deletion of an assigned custom role', async () => {
    prisma.hotelRole.deleteMany.mockRejectedValue({ code: 'P2003' });
    await expect(service.removeRole(user, 'hotel', 'custom')).rejects.toThrow(ConflictException);
  });
  it('does not update another hotel role', async () => {
    prisma.hotelRole.updateMany.mockResolvedValue({ count: 0 });
    await expect(
      service.saveRole(
        user,
        'hotel',
        { name: 'Reception', permissions: ['view_bookings'] },
        'foreign',
      ),
    ).rejects.toThrow(NotFoundException);
    expect(prisma.hotelRole.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'foreign', propertyId: 'hotel' } }),
    );
  });
  it('validates owner and platform role escalation attempts at the DTO boundary', async () => {
    expect(
      await validate(
        Object.assign(new AssignMemberDto(), { email: 'staff@test.com', role: 'OWNER' }),
      ),
    ).not.toHaveLength(0);
    expect(
      await validate(
        Object.assign(new SaveHotelRoleDto(), { name: 'Reception', permissions: ['manage_staff'] }),
      ),
    ).not.toHaveLength(0);
    expect(
      await validate(
        Object.assign(new SaveHotelRoleDto(), {
          name: 'Reception',
          permissions: ['manage_all_users'],
        }),
      ),
    ).not.toHaveLength(0);
  });
});

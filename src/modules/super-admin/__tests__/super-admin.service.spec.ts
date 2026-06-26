import { BadRequestException, ConflictException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { GlobalRole, PlatformSettings, User, UserStatus } from '@prisma/client';
import { Decimal } from '@prisma/client/runtime/library';
import { SuperAdminService } from '../super-admin.service';
import type { PlatformStats } from '../super-admin.repository';

const now = new Date('2026-06-17T00:00:00.000Z');

function buildUser(overrides: Partial<User> & { id: string }): User {
  return {
    name: 'Test Admin',
    phone: '9000000000',
    email: 'test@stayflex.in',
    passwordHash: 'hash',
    globalRole: GlobalRole.ADMIN,
    isPhoneVerified: false,
    isEmailVerified: false,
    status: UserStatus.active,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  } as User;
}

function buildSettings(overrides: Partial<PlatformSettings> = {}): PlatformSettings {
  return {
    id: 'singleton',
    commissionPct: new Decimal('15.00'),
    tdsPct: new Decimal('1.00'),
    payoutDayOfWeek: 1,
    minBookingHours: 1,
    maxBookingHours: 24,
    cancellationWindowHours: 24,
    updatedAt: now,
    updatedBy: null,
    ...overrides,
  };
}

const STATS: PlatformStats = {
  totalProperties: 142,
  activeProperties: 118,
  totalBookings: 8432,
  bookingsThisMonth: 412,
  grossRevenuePaise: 184_200_000,
  grossRevenueThisMonthPaise: 9_100_000,
  totalPayoutsReleasedPaise: 156_000_000,
  totalTdsPaise: 1_560_000,
  activeAdmins: 4,
  totalOwners: 138,
  activeBookings: 23,
};

describe(SuperAdminService.name, () => {
  const CALLER_ID = 'caller-uuid-0000';
  const ADMIN_ID = 'admin-uuid-1111';
  const SUPER_ID = 'super-uuid-2222';

  const repo = {
    getStats: jest.fn(),
    listAdmins: jest.fn(),
    createAdmin: jest.fn(),
    findUserById: jest.fn(),
    updateUserStatus: jest.fn(),
    getSettings: jest.fn(),
    updateSettings: jest.fn(),
  };

  let service: SuperAdminService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new SuperAdminService(repo as never);
  });

  // ── stats ──────────────────────────────────────────────────────────────────
  describe('getStats', () => {
    it('delegates to the repository and returns raw stats', async () => {
      repo.getStats.mockResolvedValue(STATS);
      const result = await service.getStats();
      expect(repo.getStats).toHaveBeenCalledTimes(1);
      expect(result).toEqual(STATS);
    });
  });

  // ── listAdmins ─────────────────────────────────────────────────────────────
  describe('listAdmins', () => {
    it('delegates pagination to the repository', async () => {
      const admin = buildUser({ id: ADMIN_ID });
      repo.listAdmins.mockResolvedValue({ items: [admin], total: 1, page: 1, limit: 20 });

      const result = await service.listAdmins(1, 20);

      expect(repo.listAdmins).toHaveBeenCalledWith(1, 20);
      expect(result.items).toHaveLength(1);
    });
  });

  // ── createAdmin ────────────────────────────────────────────────────────────
  describe('createAdmin', () => {
    it('creates a user with ADMIN role, hashed password, and the provided email', async () => {
      const created = buildUser({ id: ADMIN_ID, name: 'New Admin', phone: '9000000001' });
      repo.createAdmin.mockResolvedValue(created);

      const result = await service.createAdmin({
        name: 'New Admin',
        phone: '9000000001',
        email: 'newadmin@stayflex.in',
      });

      expect(repo.createAdmin).toHaveBeenCalledWith(
        expect.objectContaining({
          name: 'New Admin',
          phone: '9000000001',
          email: 'newadmin@stayflex.in',
          globalRole: GlobalRole.ADMIN,
          status: UserStatus.active,
        }),
      );
      expect(result.globalRole).toBe(GlobalRole.ADMIN);
    });

    it('throws BadRequestException when email is missing (BS-02: email required for admin accounts)', async () => {
      await expect(
        service.createAdmin({ name: 'Admin', phone: '9000000002' }),
      ).rejects.toThrow(BadRequestException);
    });

    it('wraps Prisma P2002 (unique violation) as ConflictException', async () => {
      repo.createAdmin.mockRejectedValue({ code: 'P2002' });
      await expect(
        service.createAdmin({ name: 'A', phone: '9000000004', email: 'a@b.in' }),
      ).rejects.toThrow(ConflictException);
    });
  });

  // ── toggleAdminStatus ──────────────────────────────────────────────────────
  describe('toggleAdminStatus', () => {
    it('throws ForbiddenException when caller tries to suspend own account', async () => {
      await expect(
        service.toggleAdminStatus(CALLER_ID, CALLER_ID, UserStatus.suspended),
      ).rejects.toThrow(ForbiddenException);
      expect(repo.findUserById).not.toHaveBeenCalled();
    });

    it('throws NotFoundException when target user does not exist', async () => {
      repo.findUserById.mockResolvedValue(null);
      await expect(
        service.toggleAdminStatus(ADMIN_ID, CALLER_ID, UserStatus.suspended),
      ).rejects.toThrow(NotFoundException);
    });

    it('throws ForbiddenException when trying to suspend a SUPER_ADMIN', async () => {
      repo.findUserById.mockResolvedValue(
        buildUser({ id: SUPER_ID, globalRole: GlobalRole.SUPER_ADMIN }),
      );
      await expect(
        service.toggleAdminStatus(SUPER_ID, CALLER_ID, UserStatus.suspended),
      ).rejects.toThrow(ForbiddenException);
    });

    it('throws ForbiddenException when target is a regular USER', async () => {
      repo.findUserById.mockResolvedValue(
        buildUser({ id: ADMIN_ID, globalRole: GlobalRole.USER }),
      );
      await expect(
        service.toggleAdminStatus(ADMIN_ID, CALLER_ID, UserStatus.suspended),
      ).rejects.toThrow(ForbiddenException);
    });

    it('suspends an ADMIN account successfully', async () => {
      repo.findUserById.mockResolvedValue(buildUser({ id: ADMIN_ID }));
      const suspended = buildUser({ id: ADMIN_ID, status: UserStatus.suspended });
      repo.updateUserStatus.mockResolvedValue(suspended);

      const result = await service.toggleAdminStatus(ADMIN_ID, CALLER_ID, UserStatus.suspended);

      expect(repo.updateUserStatus).toHaveBeenCalledWith(ADMIN_ID, UserStatus.suspended);
      expect(result.status).toBe(UserStatus.suspended);
    });

    it('reactivates a suspended ADMIN account', async () => {
      repo.findUserById.mockResolvedValue(buildUser({ id: ADMIN_ID, status: UserStatus.suspended }));
      repo.updateUserStatus.mockResolvedValue(buildUser({ id: ADMIN_ID, status: UserStatus.active }));

      const result = await service.toggleAdminStatus(ADMIN_ID, CALLER_ID, UserStatus.active);

      expect(repo.updateUserStatus).toHaveBeenCalledWith(ADMIN_ID, UserStatus.active);
      expect(result.status).toBe(UserStatus.active);
    });
  });

  // ── settings ───────────────────────────────────────────────────────────────
  describe('getSettings', () => {
    it('returns the platform settings singleton', async () => {
      const settings = buildSettings();
      repo.getSettings.mockResolvedValue(settings);

      const result = await service.getSettings();

      expect(repo.getSettings).toHaveBeenCalledTimes(1);
      expect(result.id).toBe('singleton');
    });
  });

  describe('updateSettings', () => {
    it('passes dto fields and callerId to the repository', async () => {
      const updated = buildSettings({ commissionPct: new Decimal('18.00'), updatedBy: CALLER_ID });
      repo.updateSettings.mockResolvedValue(updated);

      const result = await service.updateSettings({ commissionPct: 18 }, CALLER_ID);

      expect(repo.updateSettings).toHaveBeenCalledWith(
        expect.objectContaining({ commissionPct: 18, updatedBy: CALLER_ID }),
      );
      expect(result.updatedBy).toBe(CALLER_ID);
    });

    it('passes partial fields without overriding unset ones', async () => {
      repo.updateSettings.mockResolvedValue(buildSettings({ payoutDayOfWeek: 5 }));

      await service.updateSettings({ payoutDayOfWeek: 5 }, CALLER_ID);

      expect(repo.updateSettings).toHaveBeenCalledWith(
        expect.objectContaining({ payoutDayOfWeek: 5 }),
      );
    });
  });
});

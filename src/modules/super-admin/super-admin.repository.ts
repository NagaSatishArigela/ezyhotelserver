import { Injectable } from '@nestjs/common';
import { GlobalRole, Prisma, PlatformSettings, User, UserStatus } from '@prisma/client';
import { PrismaService } from '../database/prisma.service';

// Admin list rows are returned straight to the HTTP response, so they must
// never carry the bcrypt passwordHash. This projection selects every User
// column EXCEPT passwordHash.
const ADMIN_LIST_SELECT = {
  id: true,
  name: true,
  phone: true,
  email: true,
  globalRole: true,
  status: true,
  isPhoneVerified: true,
  isEmailVerified: true,
  createdAt: true,
  updatedAt: true,
} satisfies Prisma.UserSelect;

export type AdminListItem = Omit<User, 'passwordHash'>;

export interface AdminListResult {
  items: AdminListItem[];
  total: number;
  page: number;
  limit: number;
}

export interface PlatformStats {
  totalProperties: number;
  activeProperties: number;
  totalBookings: number;
  bookingsThisMonth: number;
  grossRevenuePaise: number;
  grossRevenueThisMonthPaise: number;
  totalPayoutsReleasedPaise: number;
  totalTdsPaise: number;
  activeAdmins: number;
  totalOwners: number;
  activeBookings: number;
}

@Injectable()
export class SuperAdminRepository {
  constructor(private readonly prisma: PrismaService) {}

  async getStats(): Promise<PlatformStats> {
    const now = new Date();
    const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));

    const [
      propertyRows,
      bookingRows,
      payoutRows,
      adminCount,
      ownerCount,
    ] = await Promise.all([
      this.prisma.$queryRaw<{ total: bigint; active: bigint }[]>`
        SELECT
          COUNT(*)                                        AS total,
          COUNT(*) FILTER (WHERE is_active = true)        AS active
        FROM properties.properties
      `,
      this.prisma.$queryRaw<{
        total: bigint;
        this_month: bigint;
        gross_all: bigint;
        gross_month: bigint;
        active_count: bigint;
      }[]>`
        SELECT
          COUNT(*)                                                         AS total,
          COUNT(*) FILTER (WHERE created_at >= ${monthStart})             AS this_month,
          COALESCE(SUM(base_amount_paise), 0)                              AS gross_all,
          COALESCE(SUM(base_amount_paise) FILTER (WHERE created_at >= ${monthStart}), 0) AS gross_month,
          COUNT(*) FILTER (WHERE status IN ('confirmed','checked_in'))    AS active_count
        FROM bookings.bookings
      `,
      this.prisma.$queryRaw<{ released: bigint; tds: bigint }[]>`
        SELECT
          COALESCE(SUM(net_amount_paise), 0)  AS released,
          COALESCE(SUM(tds_paise), 0)         AS tds
        FROM payouts.payout_items
        WHERE status = 'released'
      `,
      this.prisma.user.count({
        where: { globalRole: { in: [GlobalRole.ADMIN, GlobalRole.SUPER_ADMIN] }, status: UserStatus.active },
      }),
      this.prisma.user.count({ where: { globalRole: GlobalRole.USER } }),
    ]);

    const p = propertyRows[0];
    const b = bookingRows[0];
    const pay = payoutRows[0];

    return {
      totalProperties: Number(p?.total ?? 0),
      activeProperties: Number(p?.active ?? 0),
      totalBookings: Number(b?.total ?? 0),
      bookingsThisMonth: Number(b?.this_month ?? 0),
      grossRevenuePaise: Number(b?.gross_all ?? 0),
      grossRevenueThisMonthPaise: Number(b?.gross_month ?? 0),
      totalPayoutsReleasedPaise: Number(pay?.released ?? 0),
      totalTdsPaise: Number(pay?.tds ?? 0),
      activeAdmins: adminCount,
      totalOwners: ownerCount,
      activeBookings: Number(b?.active_count ?? 0),
    };
  }

  async listAdmins(page: number, limit: number): Promise<AdminListResult> {
    const skip = (page - 1) * limit;
    const where: Prisma.UserWhereInput = {
      globalRole: { in: [GlobalRole.ADMIN, GlobalRole.SUPER_ADMIN] },
    };
    const [items, total] = await this.prisma.$transaction([
      this.prisma.user.findMany({
        where,
        skip,
        take: limit,
        orderBy: { createdAt: 'desc' },
        select: ADMIN_LIST_SELECT,
      }),
      this.prisma.user.count({ where }),
    ]);
    return { items, total, page, limit };
  }

  createAdmin(data: Prisma.UserCreateInput): Promise<User> {
    return this.prisma.user.create({ data });
  }

  findUserById(id: string): Promise<User | null> {
    return this.prisma.user.findUnique({ where: { id } });
  }

  updateUserStatus(id: string, status: UserStatus): Promise<User> {
    return this.prisma.user.update({ where: { id }, data: { status } });
  }

  async getSettings(): Promise<PlatformSettings> {
    return this.prisma.platformSettings.upsert({
      where: { id: 'singleton' },
      create: { id: 'singleton' },
      update: {},
    });
  }

  updateSettings(data: Prisma.PlatformSettingsUpdateInput): Promise<PlatformSettings> {
    return this.prisma.platformSettings.upsert({
      where: { id: 'singleton' },
      create: { id: 'singleton' },
      update: data,
    });
  }
}

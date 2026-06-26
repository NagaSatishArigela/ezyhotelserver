import { Injectable } from '@nestjs/common';
import { BookingAdminActionType, BookingStatus, BookingType, Prisma } from '@prisma/client';
import { PrismaService } from '../../database/prisma.service';

export interface AdminBookingFilters {
  dateFrom?: Date;
  dateTo?: Date;
  city?: string;
  propertyId?: string;
  bookingType?: BookingType;
  status?: BookingStatus[];
  amountMin?: number;
  amountMax?: number;
  guestPhone?: string;
  bookingRef?: string;
}

export interface AdminBookingRow {
  id: string;
  booking_ref: string;
  property_id: string;
  room_type_id: string;
  owner_id: string;
  guest_id: string;
  booking_type: BookingType;
  check_in_at: Date;
  check_out_at: Date;
  duration_hours: number;
  guest_count: number;
  total_amount_paise: number;
  status: BookingStatus;
  payment_status: string;
  refund_amount_paise: number | null;
  is_flagged: boolean;
  created_at: Date;
  property_name: string | null;
  city: string | null;
  guest_phone: string | null;
}

export interface AdminBookingKpiRow {
  total_bookings: bigint;
  total_gbv_paise: bigint | null;
  cancelled_count: bigint;
  no_show_count: bigint;
}

function escapeLikePattern(value: string): string {
  return value.replace(/[\\%_]/g, (char) => `\\${char}`);
}

const LIST_COLUMNS = Prisma.sql`
  b.id, b.booking_ref, b.property_id, b.room_type_id, b.owner_id, b.guest_id,
  b."bookingType" AS booking_type, b.check_in_at, b.check_out_at, b.duration_hours, b.guest_count,
  b.total_amount_paise, b.status, b.payment_status, b.refund_amount_paise,
  b.is_flagged, b.created_at,
  p.name AS property_name, p.city AS city, u.phone AS guest_phone
`;

const FROM_JOINS = Prisma.sql`
  FROM bookings.bookings b
  LEFT JOIN properties.properties p ON p.id = b.property_id
  LEFT JOIN auth.users u ON u.id = b.guest_id
`;

@Injectable()
export class AdminBookingsRepository {
  constructor(private readonly prisma: PrismaService) {}

  private buildConditions(filters: AdminBookingFilters): Prisma.Sql[] {
    const conditions: Prisma.Sql[] = [];

    if (filters.dateFrom) {
      conditions.push(Prisma.sql`b.check_in_at >= ${filters.dateFrom}`);
    }
    if (filters.dateTo) {
      conditions.push(Prisma.sql`b.check_in_at <= ${filters.dateTo}`);
    }
    if (filters.city) {
      conditions.push(Prisma.sql`lower(p.city) = lower(${filters.city})`);
    }
    if (filters.propertyId) {
      conditions.push(Prisma.sql`b.property_id = ${filters.propertyId}::uuid`);
    }
    if (filters.bookingType) {
      conditions.push(Prisma.sql`b."bookingType" = ${filters.bookingType}::"bookings"."BookingType"`);
    }
    if (filters.status && filters.status.length > 0) {
      conditions.push(
        Prisma.sql`b.status IN (${Prisma.join(filters.status.map((s) => Prisma.sql`${s}::"bookings"."BookingStatus"`))})`,
      );
    }
    if (filters.amountMin != null) {
      conditions.push(Prisma.sql`b.total_amount_paise >= ${filters.amountMin}`);
    }
    if (filters.amountMax != null) {
      conditions.push(Prisma.sql`b.total_amount_paise <= ${filters.amountMax}`);
    }
    if (filters.guestPhone) {
      const pattern = `%${escapeLikePattern(filters.guestPhone)}%`;
      conditions.push(Prisma.sql`u.phone ILIKE ${pattern}`);
    }
    if (filters.bookingRef) {
      conditions.push(Prisma.sql`b.booking_ref = ${filters.bookingRef}`);
    }

    return conditions.length > 0 ? conditions : [Prisma.sql`TRUE`];
  }

  async findManyForAdmin(
    filters: AdminBookingFilters,
    skip: number,
    take: number,
    sort: 'createdAt' | 'checkInAt' | 'checkOutAt' | 'totalAmountPaise',
    order: 'asc' | 'desc',
  ): Promise<{ items: AdminBookingRow[]; total: number }> {
    const where = Prisma.join(this.buildConditions(filters), ' AND ');

    const sortColumn: Record<typeof sort, Prisma.Sql> = {
      createdAt: Prisma.sql`b.created_at`,
      checkInAt: Prisma.sql`b.check_in_at`,
      checkOutAt: Prisma.sql`b.check_out_at`,
      totalAmountPaise: Prisma.sql`b.total_amount_paise`,
    };
    const direction = order === 'asc' ? Prisma.sql`ASC` : Prisma.sql`DESC`;
    const orderBy = Prisma.sql`ORDER BY ${sortColumn[sort]} ${direction}`;

    const [items, countRows] = await Promise.all([
      this.prisma.$queryRaw<AdminBookingRow[]>(Prisma.sql`
        SELECT ${LIST_COLUMNS} ${FROM_JOINS} WHERE ${where} ${orderBy} LIMIT ${take} OFFSET ${skip}
      `),
      this.prisma.$queryRaw<Array<{ count: bigint }>>(Prisma.sql`
        SELECT COUNT(*) AS count ${FROM_JOINS} WHERE ${where}
      `),
    ]);

    return { items, total: Number(countRows[0]?.count ?? 0) };
  }

  async getKpis(filters: AdminBookingFilters): Promise<AdminBookingKpiRow> {
    const where = Prisma.join(this.buildConditions(filters), ' AND ');

    const rows = await this.prisma.$queryRaw<AdminBookingKpiRow[]>(Prisma.sql`
      SELECT
        COUNT(*) AS total_bookings,
        COALESCE(SUM(b.total_amount_paise), 0) AS total_gbv_paise,
        COUNT(*) FILTER (WHERE b.status IN ('cancelled', 'voided')) AS cancelled_count,
        COUNT(*) FILTER (WHERE b.status = 'no_show') AS no_show_count
      ${FROM_JOINS} WHERE ${where}
    `);

    return (
      rows[0] ?? {
        total_bookings: 0n,
        total_gbv_paise: 0n,
        cancelled_count: 0n,
        no_show_count: 0n,
      }
    );
  }

  findActive(): Promise<AdminBookingRow[]> {
    return this.prisma.$queryRaw<AdminBookingRow[]>(Prisma.sql`
      SELECT ${LIST_COLUMNS} ${FROM_JOINS}
      WHERE b.status = 'checked_in'::"bookings"."BookingStatus"
      ORDER BY b.check_out_at ASC
    `);
  }

  async findDetailRow(id: string): Promise<AdminBookingRow | null> {
    const rows = await this.prisma.$queryRaw<AdminBookingRow[]>(Prisma.sql`
      SELECT ${LIST_COLUMNS} ${FROM_JOINS} WHERE b.id = ${id}::uuid
    `);
    return rows[0] ?? null;
  }

  async findGuestContact(guestId: string): Promise<{ phone: string; email: string } | null> {
    const rows = await this.prisma.$queryRaw<Array<{ phone: string; email: string }>>(Prisma.sql`
      SELECT phone, email FROM auth.users WHERE id = ${guestId}::uuid
    `);
    return rows[0] ?? null;
  }

  async findPropertyArea(
    propertyId: string,
  ): Promise<{ id: string; name: string; city: string; area: string | null } | null> {
    const rows = await this.prisma.$queryRaw<
      Array<{ id: string; name: string; city: string; area: string | null }>
    >(Prisma.sql`
      SELECT id, name, city, address_line2 AS area FROM properties.properties WHERE id = ${propertyId}::uuid
    `);
    return rows[0] ?? null;
  }

  findAdminActions(bookingId: string) {
    return this.prisma.bookingAdminAction.findMany({
      where: { bookingId },
      orderBy: { createdAt: 'desc' },
    });
  }

  createAdminAction(data: {
    bookingId: string;
    adminId: string;
    action: BookingAdminActionType;
    reasonCategory?: string | null;
    reasonText?: string | null;
    metadata?: Prisma.InputJsonValue;
  }) {
    return this.prisma.bookingAdminAction.create({ data });
  }
}

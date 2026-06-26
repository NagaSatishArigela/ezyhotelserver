import { Injectable } from '@nestjs/common';
import { Dispute, DisputeStatus, Prisma, WalletCredit } from '@prisma/client';
import { randomBytes } from 'crypto';
import { PrismaService } from '../database/prisma.service';

export interface DisputeFilters {
  status?: DisputeStatus[];
  category?: string[];
  dateFrom?: Date;
  dateTo?: Date;
  propertyId?: string;
}

export interface DisputeListRow {
  id: string;
  dispute_ref: string;
  booking_id: string;
  guest_id: string;
  property_id: string;
  category: string;
  status: DisputeStatus;
  filed_at: Date;
  resolution_deadline: Date;
  booking_ref: string | null;
  property_name: string | null;
  guest_phone: string | null;
}

const LIST_COLUMNS = Prisma.sql`
  d.id, d.dispute_ref, d.booking_id, d.guest_id, d.property_id, d.category, d.status,
  d.filed_at, d.resolution_deadline,
  b.booking_ref, p.name AS property_name, u.phone AS guest_phone
`;

const FROM_JOINS = Prisma.sql`
  FROM bookings.disputes d
  LEFT JOIN bookings.bookings b ON b.id = d.booking_id
  LEFT JOIN properties.properties p ON p.id = d.property_id
  LEFT JOIN auth.users u ON u.id = d.guest_id
`;

@Injectable()
export class DisputesRepository {
  constructor(private readonly prisma: PrismaService) {}

  generateDisputeRef(): Promise<string> {
    return Promise.resolve(`PPH-D-${randomBytes(4).toString('hex').toUpperCase()}`);
  }

  findById(id: string): Promise<Dispute | null> {
    return this.prisma.dispute.findUnique({ where: { id } });
  }

  findByBookingId(bookingId: string): Promise<Dispute | null> {
    return this.prisma.dispute.findFirst({ where: { bookingId } });
  }

  create(data: Prisma.DisputeCreateInput): Promise<Dispute> {
    return this.prisma.dispute.create({ data });
  }

  async updateIfStatus(
    id: string,
    fromStatuses: DisputeStatus[],
    data: Prisma.DisputeUpdateInput,
  ): Promise<Dispute | null> {
    const result = await this.prisma.dispute.updateMany({
      where: { id, status: { in: fromStatuses } },
      data,
    });
    if (result.count === 0) return null;
    return this.prisma.dispute.findUnique({ where: { id } });
  }

  private buildConditions(filters: DisputeFilters): Prisma.Sql[] {
    const conditions: Prisma.Sql[] = [];

    if (filters.status && filters.status.length > 0) {
      conditions.push(
        Prisma.sql`d.status IN (${Prisma.join(filters.status.map((s) => Prisma.sql`${s}::"bookings"."DisputeStatus"`))})`,
      );
    }
    if (filters.category && filters.category.length > 0) {
      conditions.push(
        Prisma.sql`d.category IN (${Prisma.join(filters.category.map((c) => Prisma.sql`${c}::"bookings"."DisputeCategory"`))})`,
      );
    }
    if (filters.dateFrom) {
      conditions.push(Prisma.sql`d.filed_at >= ${filters.dateFrom}`);
    }
    if (filters.dateTo) {
      conditions.push(Prisma.sql`d.filed_at <= ${filters.dateTo}`);
    }
    if (filters.propertyId) {
      conditions.push(Prisma.sql`d.property_id = ${filters.propertyId}::uuid`);
    }

    return conditions.length > 0 ? conditions : [Prisma.sql`TRUE`];
  }

  async findManyForAdmin(
    filters: DisputeFilters,
    skip: number,
    take: number,
    order: 'asc' | 'desc',
  ): Promise<{ items: DisputeListRow[]; total: number }> {
    const where = Prisma.join(this.buildConditions(filters), ' AND ');
    const direction = order === 'asc' ? Prisma.sql`ASC` : Prisma.sql`DESC`;

    const [items, countRows] = await Promise.all([
      this.prisma.$queryRaw<DisputeListRow[]>(Prisma.sql`
        SELECT ${LIST_COLUMNS} ${FROM_JOINS}
        WHERE ${where}
        ORDER BY d.resolution_deadline ${direction}
        LIMIT ${take} OFFSET ${skip}
      `),
      this.prisma.$queryRaw<Array<{ count: bigint }>>(Prisma.sql`
        SELECT COUNT(*) AS count ${FROM_JOINS} WHERE ${where}
      `),
    ]);

    return { items, total: Number(countRows[0]?.count ?? 0) };
  }

  async findManyByProperty(
    propertyId: string,
    skip: number,
    take: number,
  ): Promise<{ items: DisputeListRow[]; total: number }> {
    const where = Prisma.sql`d.property_id = ${propertyId}::uuid`;

    const [items, countRows] = await Promise.all([
      this.prisma.$queryRaw<DisputeListRow[]>(Prisma.sql`
        SELECT ${LIST_COLUMNS} ${FROM_JOINS}
        WHERE ${where}
        ORDER BY d.filed_at DESC
        LIMIT ${take} OFFSET ${skip}
      `),
      this.prisma.$queryRaw<Array<{ count: bigint }>>(Prisma.sql`
        SELECT COUNT(*) AS count ${FROM_JOINS} WHERE ${where}
      `),
    ]);

    return { items, total: Number(countRows[0]?.count ?? 0) };
  }

  countUnresolved(): Promise<number> {
    return this.prisma.dispute.count({
      where: {
        status: {
          in: [DisputeStatus.filed, DisputeStatus.under_review, DisputeStatus.awaiting_hotel_response],
        },
      },
    });
  }

  countByGuest(guestId: string): Promise<number> {
    return this.prisma.dispute.count({ where: { guestId } });
  }

  countByProperty(propertyId: string): Promise<number> {
    return this.prisma.dispute.count({ where: { propertyId } });
  }

  findExpired(now: Date): Promise<Dispute[]> {
    return this.prisma.dispute.findMany({
      where: {
        status: {
          in: [DisputeStatus.filed, DisputeStatus.under_review, DisputeStatus.awaiting_hotel_response],
        },
        resolutionDeadline: { lt: now },
      },
    });
  }

  createWalletCredit(data: Prisma.WalletCreditCreateInput): Promise<WalletCredit> {
    return this.prisma.walletCredit.create({ data });
  }
}

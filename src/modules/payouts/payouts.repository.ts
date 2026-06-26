import { Injectable } from '@nestjs/common';
import { PayoutBatch, PayoutBatchStatus, PayoutItem, PayoutItemStatus, Prisma } from '@prisma/client';
import { PrismaService } from '../database/prisma.service';

export interface CompletedBookingRow {
  booking_id: string;
  property_id: string;
  owner_id: string;
  base_amount_paise: bigint;
  platform_fee_paise: bigint;
  refund_amount_paise: bigint;
}

export interface PayoutBatchWithItems extends PayoutBatch {
  items: (PayoutItem & { bookings: { bookingId: string; ownerGrossPaise: number; tdsPaise: number }[] })[];
}

export interface OwnerItemRow {
  id: string;
  batch_id: string;
  batch_ref: string;
  cycle_start_at: Date;
  cycle_end_at: Date;
  batch_status: PayoutBatchStatus;
  status: PayoutItemStatus;
  booking_count: number;
  gross_amount_paise: number;
  tds_paise: number;
  net_amount_paise: number;
  released_at: Date | null;
}

@Injectable()
export class PayoutsRepository {
  constructor(private readonly prisma: PrismaService) {}

  findBatchById(id: string): Promise<PayoutBatch | null> {
    return this.prisma.payoutBatch.findUnique({ where: { id } });
  }

  findBatchWithItems(id: string): Promise<PayoutBatchWithItems | null> {
    return this.prisma.payoutBatch.findUnique({
      where: { id },
      include: { items: { include: { bookings: { select: { bookingId: true, ownerGrossPaise: true, tdsPaise: true } } } } },
    }) as Promise<PayoutBatchWithItems | null>;
  }

  findItemById(id: string): Promise<PayoutItem | null> {
    return this.prisma.payoutItem.findUnique({ where: { id } });
  }

  createBatch(data: Prisma.PayoutBatchCreateInput): Promise<PayoutBatch> {
    return this.prisma.payoutBatch.create({ data });
  }

  updateBatch(id: string, data: Prisma.PayoutBatchUpdateInput): Promise<PayoutBatch> {
    return this.prisma.payoutBatch.update({ where: { id }, data });
  }

  updateItem(id: string, data: Prisma.PayoutItemUpdateInput): Promise<PayoutItem> {
    return this.prisma.payoutItem.update({ where: { id }, data });
  }

  listBatchesAdmin(status: PayoutBatchStatus | undefined, page: number, limit: number): Promise<[PayoutBatch[], number]> {
    const where: Prisma.PayoutBatchWhereInput = status ? { status } : {};
    return Promise.all([
      this.prisma.payoutBatch.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
        include: { items: { select: { id: true, status: true, netAmountPaise: true } } },
      }),
      this.prisma.payoutBatch.count({ where }),
    ]);
  }

  countOnHoldItems(): Promise<number> {
    return this.prisma.payoutItem.count({ where: { status: PayoutItemStatus.on_hold } });
  }

  async adminSummary(): Promise<{ pendingBatches: number; onHoldItems: number; releasedMtdPaise: number; tdsMtdPaise: number }> {
    const now = new Date();
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);

    const [pendingBatches, onHoldItems, mtd] = await Promise.all([
      this.prisma.payoutBatch.count({ where: { status: PayoutBatchStatus.pending } }),
      this.prisma.payoutItem.count({ where: { status: PayoutItemStatus.on_hold } }),
      this.prisma.payoutItem.aggregate({
        _sum: { netAmountPaise: true, tdsPaise: true },
        where: { status: PayoutItemStatus.released, releasedAt: { gte: monthStart } },
      }),
    ]);

    return {
      pendingBatches,
      onHoldItems,
      releasedMtdPaise: mtd._sum.netAmountPaise ?? 0,
      tdsMtdPaise: mtd._sum.tdsPaise ?? 0,
    };
  }

  async listOwnerItems(ownerId: string, page: number, limit: number): Promise<[OwnerItemRow[], number]> {
    const [rows, total] = await Promise.all([
      this.prisma.$queryRaw<OwnerItemRow[]>`
        SELECT
          pi.id,
          pi.batch_id,
          pb.batch_ref,
          pb.cycle_start_at,
          pb.cycle_end_at,
          pb.status AS batch_status,
          pi.status,
          pi.booking_count,
          pi.gross_amount_paise,
          pi.tds_paise,
          pi.net_amount_paise,
          pi.released_at
        FROM payouts.payout_items pi
        JOIN payouts.payout_batches pb ON pb.id = pi.batch_id
        WHERE pi.owner_id = ${ownerId}::uuid
        ORDER BY pb.cycle_start_at DESC
        LIMIT ${limit} OFFSET ${(page - 1) * limit}
      `,
      this.prisma.payoutItem.count({ where: { ownerId } }),
    ]);
    return [rows, total];
  }

  async ownerItemDetail(
    batchId: string,
    ownerId: string,
  ): Promise<(PayoutItem & { batch: PayoutBatch; bookings: { bookingId: string; ownerGrossPaise: number; tdsPaise: number }[] }) | null> {
    return this.prisma.payoutItem.findFirst({
      where: { batchId, ownerId },
      include: {
        batch: true,
        bookings: { select: { bookingId: true, ownerGrossPaise: true, tdsPaise: true } },
      },
    }) as Promise<(PayoutItem & { batch: PayoutBatch; bookings: { bookingId: string; ownerGrossPaise: number; tdsPaise: number }[] }) | null>;
  }

  async getCompletedBookingsForCycle(cycleStart: Date, cycleEnd: Date): Promise<CompletedBookingRow[]> {
    return this.prisma.$queryRaw<CompletedBookingRow[]>`
      SELECT
        b.id          AS booking_id,
        b.property_id,
        b.owner_id,
        b.base_amount_paise,
        b.platform_fee_paise,
        COALESCE(b.refund_amount_paise, 0) AS refund_amount_paise
      FROM bookings.bookings b
      WHERE b.status = 'completed'
        AND b.check_out_at >= ${cycleStart}
        AND b.check_out_at <= ${cycleEnd}
        AND NOT EXISTS (
          SELECT 1 FROM payouts.payout_booking_links pbl WHERE pbl.booking_id = b.id
        )
    `;
  }

  async upsertBatchItems(
    batchId: string,
    items: { propertyId: string; ownerId: string; bookings: { bookingId: string; ownerGrossPaise: number; tdsPaise: number }[] }[],
  ): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      for (const item of items) {
        const grossAmountPaise = item.bookings.reduce((s, b) => s + b.ownerGrossPaise, 0);
        const tdsPaise = item.bookings.reduce((s, b) => s + b.tdsPaise, 0);
        const netAmountPaise = grossAmountPaise - tdsPaise;

        const pi = await tx.payoutItem.upsert({
          where: { batchId_propertyId: { batchId, propertyId: item.propertyId } },
          create: {
            batchId,
            propertyId: item.propertyId,
            ownerId: item.ownerId,
            bookingCount: item.bookings.length,
            grossAmountPaise,
            tdsPaise,
            netAmountPaise,
          },
          update: {
            bookingCount: { increment: item.bookings.length },
            grossAmountPaise: { increment: grossAmountPaise },
            tdsPaise: { increment: tdsPaise },
            netAmountPaise: { increment: netAmountPaise },
          },
        });

        await tx.$executeRaw`
          INSERT INTO payouts.payout_booking_links (id, payout_item_id, booking_id, owner_gross_paise, tds_paise)
          SELECT gen_random_uuid(), ${pi.id}::uuid, b.booking_id::uuid, b.owner_gross_paise, b.tds_paise
          FROM jsonb_to_recordset(${JSON.stringify(item.bookings)}::jsonb)
            AS b(booking_id text, owner_gross_paise int, tds_paise int)
          ON CONFLICT (booking_id) DO NOTHING
        `;
      }
    });
  }

  /** Creates batch record, upserts items, and updates totals in a single transaction. */
  async createBatchAtomic(
    batchRef: string,
    cycleStartAt: Date,
    cycleEndAt: Date,
    items: { propertyId: string; ownerId: string; bookings: { bookingId: string; ownerGrossPaise: number; tdsPaise: number }[] }[],
    totalGrossPaise: number,
    totalTdsPaise: number,
    totalNetPaise: number,
  ): Promise<PayoutBatch> {
    return this.prisma.$transaction(async (tx) => {
      const batch = await tx.payoutBatch.create({
        data: { batchRef, cycleStartAt, cycleEndAt, status: PayoutBatchStatus.processing },
      });

      for (const item of items) {
        const grossAmountPaise = item.bookings.reduce((s, b) => s + b.ownerGrossPaise, 0);
        const tdsPaise = item.bookings.reduce((s, b) => s + b.tdsPaise, 0);
        const netAmountPaise = grossAmountPaise - tdsPaise;

        const pi = await tx.payoutItem.upsert({
          where: { batchId_propertyId: { batchId: batch.id, propertyId: item.propertyId } },
          create: {
            batchId: batch.id,
            propertyId: item.propertyId,
            ownerId: item.ownerId,
            bookingCount: item.bookings.length,
            grossAmountPaise,
            tdsPaise,
            netAmountPaise,
          },
          update: {
            bookingCount: { increment: item.bookings.length },
            grossAmountPaise: { increment: grossAmountPaise },
            tdsPaise: { increment: tdsPaise },
            netAmountPaise: { increment: netAmountPaise },
          },
        });

        await tx.$executeRaw`
          INSERT INTO payouts.payout_booking_links (id, payout_item_id, booking_id, owner_gross_paise, tds_paise)
          SELECT gen_random_uuid(), ${pi.id}::uuid, b.booking_id::uuid, b.owner_gross_paise, b.tds_paise
          FROM jsonb_to_recordset(${JSON.stringify(item.bookings)}::jsonb)
            AS b(booking_id text, owner_gross_paise int, tds_paise int)
          ON CONFLICT (booking_id) DO NOTHING
        `;
      }

      return tx.payoutBatch.update({
        where: { id: batch.id },
        data: {
          status: PayoutBatchStatus.pending,
          itemCount: items.length,
          totalGrossPaise,
          totalTdsPaise,
          totalNetPaise,
        },
      });
    });
  }
}

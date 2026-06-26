import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PayoutBatch, PayoutBatchStatus, PayoutItem, PayoutItemStatus } from '@prisma/client';
import { DOMAIN_EVENTS } from '../../common/events/domain-events';
import { TypedEventEmitter } from '../../common/events/typed-event-emitter.service';
import { GenerateBatchDto } from './dto/generate-batch.dto';
import { ListAdminPayoutsQueryDto, ListPayoutsQueryDto } from './dto/list-payouts-query.dto';
import { CompletedBookingRow, OwnerItemRow, PayoutBatchWithItems, PayoutsRepository } from './payouts.repository';

export interface BatchSummary {
  id: string;
  batchRef: string;
  cycleStartAt: Date;
  cycleEndAt: Date;
  status: PayoutBatchStatus;
  totalGrossPaise: number;
  totalTdsPaise: number;
  totalNetPaise: number;
  itemCount: number;
  createdAt: Date;
}

export interface OwnerPayoutSummary {
  id: string;
  batchRef: string;
  cycleStartAt: Date;
  cycleEndAt: Date;
  batchStatus: PayoutBatchStatus;
  status: PayoutItemStatus;
  grossAmountPaise: number;
  tdsPaise: number;
  netAmountPaise: number;
  bookingCount: number;
  releasedAt: Date | null;
}

function ownerGrossForBooking(row: CompletedBookingRow): number {
  const base = Number(row.base_amount_paise);
  const fee = Number(row.platform_fee_paise);
  const refund = Number(row.refund_amount_paise);
  const gross = Math.max(0, base - fee - refund);
  return gross;
}

function computeTds(ownerGross: number): number {
  return Math.round(ownerGross * 0.01);
}

function makeBatchRef(cycleEnd: Date): string {
  const y = cycleEnd.getUTCFullYear();
  const m = String(cycleEnd.getUTCMonth() + 1).padStart(2, '0');
  const d = String(cycleEnd.getUTCDate()).padStart(2, '0');
  return `PAY-${y}${m}${d}`;
}

@Injectable()
export class PayoutsService {
  constructor(
    private readonly repo: PayoutsRepository,
    private readonly events: TypedEventEmitter,
  ) {}

  async generateBatch(dto: GenerateBatchDto): Promise<{ batchId: string; batchRef: string; itemCount: number; totalNetPaise: number }> {
    const cycleStart = new Date(dto.cycleStartAt);
    const cycleEnd = new Date(dto.cycleEndAt);
    const batchRef = makeBatchRef(cycleEnd);

    // Read completed bookings outside the transaction — no write needed here.
    const bookingRows = await this.repo.getCompletedBookingsForCycle(cycleStart, cycleEnd);

    const propertyMap = new Map<
      string,
      { propertyId: string; ownerId: string; bookings: { bookingId: string; ownerGrossPaise: number; tdsPaise: number }[] }
    >();

    for (const row of bookingRows) {
      const ownerGross = ownerGrossForBooking(row);
      if (ownerGross <= 0) continue;
      const tds = computeTds(ownerGross);

      let entry = propertyMap.get(row.property_id);
      if (!entry) {
        entry = { propertyId: row.property_id, ownerId: row.owner_id, bookings: [] };
        propertyMap.set(row.property_id, entry);
      }
      entry.bookings.push({ bookingId: row.booking_id, ownerGrossPaise: ownerGross, tdsPaise: tds });
    }

    const items = Array.from(propertyMap.values());

    const totalNet = items.reduce(
      (sum, it) => sum + it.bookings.reduce((s, b) => s + b.ownerGrossPaise - b.tdsPaise, 0),
      0,
    );
    const totalGross = items.reduce(
      (sum, it) => sum + it.bookings.reduce((s, b) => s + b.ownerGrossPaise, 0),
      0,
    );
    const totalTds = items.reduce(
      (sum, it) => sum + it.bookings.reduce((s, b) => s + b.tdsPaise, 0),
      0,
    );

    // Atomically create the batch record, upsert all items, and update totals.
    const batch = await this.repo.createBatchAtomic(
      batchRef, cycleStart, cycleEnd, items, totalGross, totalTds, totalNet,
    );

    return { batchId: batch.id, batchRef, itemCount: items.length, totalNetPaise: totalNet };
  }

  async releaseBatch(batchId: string): Promise<{ released: number; skipped: number }> {
    const batch = await this.repo.findBatchWithItems(batchId);
    if (!batch) throw new NotFoundException('Batch not found');
    if (batch.status === PayoutBatchStatus.released) throw new BadRequestException('Batch already released');

    let released = 0;
    let skipped = 0;

    for (const item of batch.items) {
      if (item.status !== PayoutItemStatus.pending) {
        skipped++;
        continue;
      }
      await this.releaseItemInternal(item, batch.batchRef);
      released++;
    }

    const newStatus =
      skipped === 0 ? PayoutBatchStatus.released : released === 0 ? PayoutBatchStatus.failed : PayoutBatchStatus.partial;

    await this.repo.updateBatch(batchId, { status: newStatus });

    return { released, skipped };
  }

  async holdItem(itemId: string, reason: string): Promise<PayoutItem> {
    const item = await this.repo.findItemById(itemId);
    if (!item) throw new NotFoundException('Payout item not found');
    if (item.status !== PayoutItemStatus.pending) {
      throw new BadRequestException(`Cannot hold item in status: ${item.status}`);
    }
    return this.repo.updateItem(itemId, { status: PayoutItemStatus.on_hold, holdReason: reason });
  }

  async releaseItem(itemId: string): Promise<PayoutItem> {
    const item = await this.repo.findItemById(itemId);
    if (!item) throw new NotFoundException('Payout item not found');
    if (item.status !== PayoutItemStatus.on_hold) {
      throw new BadRequestException(`Cannot release item in status: ${item.status}`);
    }
    const batch = await this.repo.findBatchById(item.batchId);
    return this.releaseItemInternal(item, batch?.batchRef ?? 'UNKNOWN');
  }

  private async releaseItemInternal(
    item: PayoutItem & { bookings?: unknown[] },
    batchRef: string,
  ): Promise<PayoutItem> {
    // TODO: Replace with real payment gateway call. Production flow should:
    // (1) set status to processing, (2) call bank API asynchronously,
    // (3) update to released or failed via webhook/callback.
    try {
      const bankRef = `MOCK-${Date.now()}-${item.id.slice(0, 8)}`;
      const updated = await this.repo.updateItem(item.id, {
        status: PayoutItemStatus.released,
        releasedAt: new Date(),
        bankRef,
        holdReason: null,
      });

      this.events.emit(DOMAIN_EVENTS.PAYOUT_RELEASED, {
        payoutItemId: item.id,
        ownerId: item.ownerId,
        propertyId: item.propertyId,
        netAmountPaise: item.netAmountPaise,
        batchRef,
      });

      return updated;
    } catch (err) {
      return this.repo.updateItem(item.id, {
        status: PayoutItemStatus.failed,
        holdReason: err instanceof Error ? err.message : 'Bank transfer failed',
      });
    }
  }

  async adminListBatches(query: ListAdminPayoutsQueryDto): Promise<{ items: PayoutBatch[]; total: number; page: number; limit: number }> {
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;
    const [items, total] = await this.repo.listBatchesAdmin(query.status, page, limit);
    return { items, total, page, limit };
  }

  async adminBatchDetail(batchId: string): Promise<PayoutBatchWithItems> {
    const batch = await this.repo.findBatchWithItems(batchId);
    if (!batch) throw new NotFoundException('Batch not found');
    return batch;
  }

  async adminSummary(): Promise<{ pendingBatches: number; onHoldItems: number; releasedMtdPaise: number; tdsMtdPaise: number }> {
    return this.repo.adminSummary();
  }

  async ownerListPayouts(ownerId: string, query: ListPayoutsQueryDto): Promise<{ items: OwnerPayoutSummary[]; total: number; page: number; limit: number }> {
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;
    const [rows, total] = await this.repo.listOwnerItems(ownerId, page, limit);
    const items: OwnerPayoutSummary[] = rows.map((r: OwnerItemRow) => ({
      id: r.id,
      batchRef: r.batch_ref,
      cycleStartAt: r.cycle_start_at,
      cycleEndAt: r.cycle_end_at,
      batchStatus: r.batch_status,
      status: r.status,
      grossAmountPaise: r.gross_amount_paise,
      tdsPaise: r.tds_paise,
      netAmountPaise: r.net_amount_paise,
      bookingCount: r.booking_count,
      releasedAt: r.released_at,
    }));
    return { items, total, page, limit };
  }

  async ownerPayoutDetail(batchId: string, ownerId: string): Promise<object> {
    const item = await this.repo.ownerItemDetail(batchId, ownerId);
    if (!item) throw new NotFoundException('Payout not found');
    return {
      id: item.id,
      batchRef: item.batch.batchRef,
      cycleStartAt: item.batch.cycleStartAt,
      cycleEndAt: item.batch.cycleEndAt,
      batchStatus: item.batch.status,
      status: item.status,
      grossAmountPaise: item.grossAmountPaise,
      tdsPaise: item.tdsPaise,
      netAmountPaise: item.netAmountPaise,
      bookingCount: item.bookingCount,
      releasedAt: item.releasedAt,
      bankRef: item.bankRef,
      bookings: item.bookings.map((b) => ({
        bookingId: b.bookingId,
        ownerGrossPaise: b.ownerGrossPaise,
        tdsPaise: b.tdsPaise,
      })),
    };
  }
}

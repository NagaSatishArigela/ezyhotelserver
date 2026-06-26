import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import {
  Anomaly,
  AnomalyEntityType,
  AnomalySeverity,
  AnomalyStatus,
  BookingAdminAction,
  Prisma,
} from '@prisma/client';
import {
  AnomaliesRepository,
  AnomalyFilters,
  AnomalyListRow,
  BookingSummaryRow,
} from './anomalies.repository';
import { ListAdminAnomaliesQueryDto } from './dto/list-admin-anomalies-query.dto';
import { UpdateAnomalyStatusDto } from './dto/update-anomaly-status.dto';

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

export interface AdminAnomalyListItem {
  id: string;
  ruleId: string;
  severity: AnomalySeverity;
  entityType: AnomalyEntityType;
  entityId: string;
  entityLabel: string | null;
  description: string;
  status: AnomalyStatus;
  detectedAt: Date;
  resolvedAt: Date | null;
}

export interface AdminAnomalyListResult {
  items: AdminAnomalyListItem[];
  total: number;
  page: number;
  limit: number;
}

export interface AnomalyEntityRef {
  type: AnomalyEntityType;
  id: string;
  label: string;
  href: string;
}

export interface BookingEvidenceSummary {
  id: string;
  bookingRef: string;
  status: string;
  totalAmountPaise: number;
  checkInAt: Date;
  checkOutAt: Date;
}

export interface AdminAnomalyDetail {
  anomaly: Anomaly;
  entity: AnomalyEntityRef;
  evidence: Record<string, unknown>;
  relatedActions: BookingAdminAction[];
}

function mapListRow(row: AnomalyListRow): AdminAnomalyListItem {
  return {
    id: row.id,
    ruleId: row.rule_id,
    severity: row.severity,
    entityType: row.entity_type,
    entityId: row.entity_id,
    entityLabel: row.entity_label,
    description: row.description,
    status: row.status,
    detectedAt: row.detected_at,
    resolvedAt: row.resolved_at,
  };
}

function mapBookingSummary(row: BookingSummaryRow): BookingEvidenceSummary {
  return {
    id: row.id,
    bookingRef: row.booking_ref,
    status: row.status,
    totalAmountPaise: row.total_amount_paise,
    checkInAt: row.check_in_at,
    checkOutAt: row.check_out_at,
  };
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

const EVIDENCE_ID_ARRAY_KEYS = ['sampleBookingIds', 'bookingIds'] as const;
const EVIDENCE_ID_SINGLE_KEYS = ['bookingId', 'bookingIdA', 'bookingIdB'] as const;

function collectBookingIds(evidence: Prisma.JsonValue): string[] {
  const ev = (evidence ?? {}) as Record<string, unknown>;
  const ids = new Set<string>();

  for (const key of EVIDENCE_ID_ARRAY_KEYS) {
    const arr = ev[key];
    if (Array.isArray(arr)) {
      for (const id of arr) {
        if (typeof id === 'string') ids.add(id);
      }
    }
  }
  for (const key of EVIDENCE_ID_SINGLE_KEYS) {
    const id = ev[key];
    if (typeof id === 'string') ids.add(id);
  }

  return [...ids];
}

@Injectable()
export class AdminAnomaliesService {
  constructor(private readonly repo: AnomaliesRepository) {}

  /** GET /admin/anomalies (M5B spec §3.1). */
  async list(query: ListAdminAnomaliesQueryDto): Promise<AdminAnomalyListResult> {
    const filters = this.buildFilters(query);
    const { items, total } = await this.repo.findManyForAdmin(
      filters,
      (query.page - 1) * query.limit,
      query.limit,
      query.sort,
      query.order,
    );
    return { items: items.map(mapListRow), total, page: query.page, limit: query.limit };
  }

  /** GET /admin/anomalies/unresolved-count (M5B spec §3.2). */
  async unresolvedCount(): Promise<{ count: number }> {
    return { count: await this.repo.countUnresolved() };
  }

  /** GET /admin/anomalies/:id (M5B spec §3.3). */
  async getDetail(id: string): Promise<AdminAnomalyDetail> {
    const row = await this.repo.findDetailRow(id);
    if (!row) throw new NotFoundException('Anomaly not found');

    if (row.status === AnomalyStatus.detected) {
      await this.repo.updateIfStatus(id, [AnomalyStatus.detected], { status: AnomalyStatus.investigating });
      row.status = AnomalyStatus.investigating;
    }

    const anomaly = await this.repo.findById(id);
    if (!anomaly) throw new NotFoundException('Anomaly not found');

    const bookingIds = collectBookingIds(anomaly.evidence);
    const [summaries, relatedActions] = await Promise.all([
      this.repo.findBookingSummaries(bookingIds),
      this.repo.findAdminActionsForBookings(bookingIds),
    ]);
    const summaryById = new Map(summaries.map((s) => [s.id, mapBookingSummary(s)]));

    const evidence: Record<string, unknown> = { ...((anomaly.evidence ?? {}) as Record<string, unknown>) };
    for (const key of EVIDENCE_ID_ARRAY_KEYS) {
      const arr = evidence[key];
      if (Array.isArray(arr)) {
        evidence[key] = arr.map((bookingId) => summaryById.get(bookingId as string)).filter(Boolean);
      }
    }
    for (const key of EVIDENCE_ID_SINGLE_KEYS) {
      const bookingId = evidence[key];
      if (typeof bookingId === 'string' && summaryById.has(bookingId)) {
        evidence[key] = summaryById.get(bookingId);
      }
    }

    return {
      anomaly,
      entity: this.resolveEntity(row),
      evidence,
      relatedActions,
    };
  }

  /** PATCH /admin/anomalies/:id (M5B spec §3.4). */
  async updateStatus(id: string, adminId: string, dto: UpdateAnomalyStatusDto): Promise<Anomaly> {
    await this.findOrThrow(id);

    if (dto.status === AnomalyStatus.resolved_action && (!dto.resolutionType || !dto.resolutionNotes)) {
      throw new BadRequestException(
        'resolutionType and resolutionNotes are required to resolve as Action Taken.',
      );
    }
    if (
      (dto.status === AnomalyStatus.resolved_fp || dto.status === AnomalyStatus.escalated) &&
      !dto.resolutionNotes
    ) {
      throw new BadRequestException('Notes are required to resolve this anomaly.');
    }

    const fromStatuses =
      dto.status === AnomalyStatus.investigating
        ? [AnomalyStatus.detected]
        : [AnomalyStatus.detected, AnomalyStatus.investigating];

    const data: Prisma.AnomalyUpdateInput = { status: dto.status };
    if (dto.status !== AnomalyStatus.investigating) {
      data.resolutionType = dto.resolutionType ?? null;
      data.resolutionNotes = dto.resolutionNotes ?? null;
      data.resolvedBy = adminId;
      data.resolvedAt = new Date();
    }

    const updated = await this.repo.updateIfStatus(id, fromStatuses, data);
    if (!updated) {
      throw new ConflictException('This anomaly has already been resolved.');
    }
    return updated;
  }

  /** Background rule engine (M5B spec §2.2), invoked by AnomalyDetectionScheduler. */
  async runDetection(): Promise<number> {
    const now = Date.now();
    let created = 0;

    created += await this.detectHighCancellationRate(new Date(now - 7 * DAY_MS));
    created += await this.detectPaymentFailureSpike(new Date(now - HOUR_MS));
    created += await this.detectOverbooking();
    created += await this.detectBookingVelocity(new Date(now - DAY_MS));
    created += await this.detectNoShowCluster(new Date(now - DAY_MS));
    created += await this.detectLateNightSpike(new Date(now - 6 * HOUR_MS));
    created += await this.detectRefundAbuse(new Date(now - 90 * DAY_MS));
    created += await this.detectManualFlags();
    created += await this.detectGuestFavourDisputes(new Date(now - 30 * DAY_MS));

    return created;
  }

  private buildFilters(query: ListAdminAnomaliesQueryDto): AnomalyFilters {
    return {
      severity: query.severity,
      ruleId: query.ruleId,
      status: query.status,
      dateFrom: query.dateFrom ? new Date(query.dateFrom) : undefined,
      dateTo: query.dateTo ? new Date(query.dateTo) : undefined,
      propertyId: query.propertyId,
      customerId: query.customerId,
    };
  }

  private async findOrThrow(id: string): Promise<Anomaly> {
    const anomaly = await this.repo.findById(id);
    if (!anomaly) throw new NotFoundException('Anomaly not found');
    return anomaly;
  }

  private resolveEntity(row: AnomalyListRow): AnomalyEntityRef {
    const label = row.entity_label ?? row.entity_id;
    switch (row.entity_type) {
      case AnomalyEntityType.property:
        return { type: row.entity_type, id: row.entity_id, label, href: `/admin/bookings?propertyId=${row.entity_id}` };
      case AnomalyEntityType.customer:
        return {
          type: row.entity_type,
          id: row.entity_id,
          label,
          href: row.entity_label ? `/admin/bookings?guestPhone=${row.entity_label}` : '/admin/bookings',
        };
      case AnomalyEntityType.booking:
      default:
        return {
          type: row.entity_type,
          id: row.entity_id,
          label,
          href: row.entity_label ? `/admin/bookings?bookingRef=${row.entity_label}` : '/admin/bookings',
        };
    }
  }

  private async isDuplicate(ruleId: string, entityType: AnomalyEntityType, entityId: string): Promise<boolean> {
    const existing = await this.repo.findUnresolvedByRule(ruleId, entityType, entityId);
    return existing !== null;
  }

  /** ANO-001 High cancellation rate. */
  private async detectHighCancellationRate(windowStart: Date): Promise<number> {
    const candidates = await this.repo.findHighCancellationRateCandidates(windowStart);
    let created = 0;

    for (const c of candidates) {
      const rate = c.cancelled_count / c.total_count;
      if (rate <= 0.3) continue;
      if (await this.isDuplicate('ANO-001', AnomalyEntityType.property, c.entity_id)) continue;

      const ratePct = round2(rate * 100);
      const propertyName = c.entity_label ?? c.entity_id;
      await this.repo.create({
        ruleId: 'ANO-001',
        severity: AnomalySeverity.medium,
        entityType: AnomalyEntityType.property,
        entityId: c.entity_id,
        description: `${propertyName} had ${c.cancelled_count} cancellations out of ${c.total_count} bookings in the last 7 days (${ratePct}% cancellation rate, threshold: 30%).`,
        evidence: {
          cancelledCount: c.cancelled_count,
          totalCount: c.total_count,
          rate: ratePct,
          windowDays: 7,
          sampleBookingIds: c.sample_ids,
        },
      });
      created++;
    }

    return created;
  }

  /** ANO-002 Payment failure spike. */
  private async detectPaymentFailureSpike(windowStart: Date): Promise<number> {
    const candidates = await this.repo.findPaymentFailureSpikeCandidates(windowStart);
    let created = 0;

    for (const c of candidates) {
      if (await this.isDuplicate('ANO-002', AnomalyEntityType.property, c.entity_id)) continue;

      const propertyName = c.entity_label ?? c.entity_id;
      await this.repo.create({
        ruleId: 'ANO-002',
        severity: AnomalySeverity.high,
        entityType: AnomalyEntityType.property,
        entityId: c.entity_id,
        description: `${propertyName} had ${c.failed_count} failed payments in the last hour (threshold: 5).`,
        evidence: { failedCount: c.failed_count, windowHours: 1, sampleBookingIds: c.sample_ids },
      });
      created++;
    }

    return created;
  }

  /** ANO-003 Overbooking detected. */
  private async detectOverbooking(): Promise<number> {
    const pairs = await this.repo.findOverbookingPairs();
    let created = 0;

    for (const pair of pairs) {
      if (await this.isDuplicate('ANO-003', AnomalyEntityType.booking, pair.booking_id_a)) continue;

      await this.repo.create({
        ruleId: 'ANO-003',
        severity: AnomalySeverity.critical,
        entityType: AnomalyEntityType.booking,
        entityId: pair.booking_id_a,
        description: `Bookings ${pair.booking_ref_a} and ${pair.booking_ref_b} both reserve room type ${pair.room_type_id} with overlapping dates (${pair.overlap_start.toISOString()} - ${pair.overlap_end.toISOString()}).`,
        evidence: {
          bookingIdA: pair.booking_id_a,
          bookingIdB: pair.booking_id_b,
          roomTypeId: pair.room_type_id,
          overlapStart: pair.overlap_start.toISOString(),
          overlapEnd: pair.overlap_end.toISOString(),
        },
      });
      created++;
    }

    return created;
  }

  /** ANO-004 Suspicious booking velocity. */
  private async detectBookingVelocity(windowStart: Date): Promise<number> {
    const candidates = await this.repo.findBookingVelocityCandidates(windowStart);
    let created = 0;

    for (const c of candidates) {
      if (await this.isDuplicate('ANO-004', AnomalyEntityType.customer, c.entity_id)) continue;

      const guestLabel = c.entity_label ?? c.entity_id;
      await this.repo.create({
        ruleId: 'ANO-004',
        severity: AnomalySeverity.medium,
        entityType: AnomalyEntityType.customer,
        entityId: c.entity_id,
        description: `Guest ${guestLabel} made ${c.booking_count} bookings in the last 24 hours (threshold: 5).`,
        evidence: { bookingCount: c.booking_count, windowHours: 24, bookingIds: c.booking_ids },
      });
      created++;
    }

    return created;
  }

  /** ANO-006 No-show cluster. */
  private async detectNoShowCluster(windowStart: Date): Promise<number> {
    const candidates = await this.repo.findNoShowClusterCandidates(windowStart);
    let created = 0;

    for (const c of candidates) {
      if (await this.isDuplicate('ANO-006', AnomalyEntityType.property, c.entity_id)) continue;

      const propertyName = c.entity_label ?? c.entity_id;
      await this.repo.create({
        ruleId: 'ANO-006',
        severity: AnomalySeverity.medium,
        entityType: AnomalyEntityType.property,
        entityId: c.entity_id,
        description: `${propertyName} had ${c.no_show_count} no-shows in the last 24 hours (threshold: 3).`,
        evidence: { noShowCount: c.no_show_count, windowHours: 24, bookingIds: c.booking_ids },
      });
      created++;
    }

    return created;
  }

  /** ANO-007 Late-night booking spike. */
  private async detectLateNightSpike(windowStart: Date): Promise<number> {
    const candidates = await this.repo.findLateNightSpikeCandidates(windowStart);
    let created = 0;

    for (const c of candidates) {
      if (await this.isDuplicate('ANO-007', AnomalyEntityType.property, c.entity_id)) continue;

      const propertyName = c.entity_label ?? c.entity_id;
      await this.repo.create({
        ruleId: 'ANO-007',
        severity: AnomalySeverity.low,
        entityType: AnomalyEntityType.property,
        entityId: c.entity_id,
        description: `${propertyName} received ${c.booking_count} bookings made between 11 PM and 5 AM in the last 6 hours (threshold: 10).`,
        evidence: { bookingCount: c.booking_count, windowHours: 6, bookingIds: c.booking_ids },
      });
      created++;
    }

    return created;
  }

  /** ANO-009 Refund abuse. */
  private async detectRefundAbuse(windowStart: Date): Promise<number> {
    const candidates = await this.repo.findRefundAbuseCandidates(windowStart);
    let created = 0;

    for (const c of candidates) {
      const rate = c.refunded_count / c.total_count;
      if (rate <= 0.4) continue;
      if (await this.isDuplicate('ANO-009', AnomalyEntityType.customer, c.entity_id)) continue;

      const ratePct = round2(rate * 100);
      const guestLabel = c.entity_label ?? c.entity_id;
      await this.repo.create({
        ruleId: 'ANO-009',
        severity: AnomalySeverity.high,
        entityType: AnomalyEntityType.customer,
        entityId: c.entity_id,
        description: `Guest ${guestLabel} had refunds on ${c.refunded_count} of ${c.total_count} bookings in the last 90 days (${ratePct}% refund rate, threshold: 40%).`,
        evidence: {
          refundedCount: c.refunded_count,
          totalCount: c.total_count,
          rate: ratePct,
          windowDays: 90,
          sampleBookingIds: c.sample_ids,
        },
      });
      created++;
    }

    return created;
  }

  /** ANO-011 Repeated guest-favour dispute resolutions (M6 spec §5). */
  private async detectGuestFavourDisputes(windowStart: Date): Promise<number> {
    const candidates = await this.repo.findGuestFavourDisputeCandidates(windowStart);
    let created = 0;

    for (const c of candidates) {
      if (await this.isDuplicate('ANO-011', AnomalyEntityType.property, c.entity_id)) continue;

      const propertyName = c.entity_label ?? c.entity_id;
      await this.repo.create({
        ruleId: 'ANO-011',
        severity: AnomalySeverity.high,
        entityType: AnomalyEntityType.property,
        entityId: c.entity_id,
        description: `${propertyName} has had ${c.dispute_count} dispute(s) resolved in the guest's favour in the last 30 days (threshold: 5).`,
        evidence: {
          disputeCount: c.dispute_count,
          windowDays: 30,
          sampleDisputeIds: c.sample_ids,
        },
      });
      created++;
    }

    return created;
  }

  /** ANO-010 Manual flag. */
  private async detectManualFlags(): Promise<number> {
    const flagged = await this.repo.findFlaggedBookings();
    let created = 0;

    for (const booking of flagged) {
      if (await this.isDuplicate('ANO-010', AnomalyEntityType.booking, booking.id)) continue;

      await this.repo.create({
        ruleId: 'ANO-010',
        severity: AnomalySeverity.medium,
        entityType: AnomalyEntityType.booking,
        entityId: booking.id,
        description: `Booking ${booking.booking_ref} was manually flagged (${booking.flag_type ?? 'unspecified'})${booking.flag_notes ? `: ${booking.flag_notes}` : '.'}`,
        evidence: { bookingId: booking.id, flagType: booking.flag_type, flagNotes: booking.flag_notes },
      });
      created++;
    }

    return created;
  }
}

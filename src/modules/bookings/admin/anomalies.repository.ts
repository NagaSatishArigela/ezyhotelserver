import { Injectable } from '@nestjs/common';
import { Anomaly, AnomalyEntityType, AnomalySeverity, AnomalyStatus, Prisma } from '@prisma/client';
import { PrismaService } from '../../database/prisma.service';

export interface AnomalyFilters {
  severity?: AnomalySeverity[];
  ruleId?: string;
  status?: AnomalyStatus[];
  dateFrom?: Date;
  dateTo?: Date;
  propertyId?: string;
  customerId?: string;
}

export interface AnomalyListRow {
  id: string;
  rule_id: string;
  severity: AnomalySeverity;
  entity_type: AnomalyEntityType;
  entity_id: string;
  description: string;
  evidence: Prisma.JsonValue;
  status: AnomalyStatus;
  resolution_type: string | null;
  resolution_notes: string | null;
  resolved_by: string | null;
  detected_at: Date;
  resolved_at: Date | null;
  entity_label: string | null;
}

export interface BookingSummaryRow {
  id: string;
  booking_ref: string;
  status: string;
  total_amount_paise: number;
  check_in_at: Date;
  check_out_at: Date;
}

const LIST_COLUMNS = Prisma.sql`
  a.id, a.rule_id, a.severity, a.entity_type, a.entity_id, a.description, a.evidence,
  a.status, a.resolution_type, a.resolution_notes, a.resolved_by, a.detected_at, a.resolved_at,
  COALESCE(p.name, u.phone, b.booking_ref) AS entity_label
`;

const FROM_JOINS = Prisma.sql`
  FROM bookings.anomalies a
  LEFT JOIN properties.properties p ON a.entity_type = 'property'::"bookings"."AnomalyEntityType" AND p.id = a.entity_id
  LEFT JOIN auth.users u ON a.entity_type = 'customer'::"bookings"."AnomalyEntityType" AND u.id = a.entity_id
  LEFT JOIN bookings.bookings b ON a.entity_type = 'booking'::"bookings"."AnomalyEntityType" AND b.id = a.entity_id
`;

const SEVERITY_RANK = Prisma.sql`
  CASE a.severity
    WHEN 'critical' THEN 3
    WHEN 'high' THEN 2
    WHEN 'medium' THEN 1
    WHEN 'low' THEN 0
  END
`;

@Injectable()
export class AnomaliesRepository {
  constructor(private readonly prisma: PrismaService) {}

  private buildConditions(filters: AnomalyFilters): Prisma.Sql[] {
    const conditions: Prisma.Sql[] = [];

    if (filters.severity && filters.severity.length > 0) {
      conditions.push(
        Prisma.sql`a.severity IN (${Prisma.join(filters.severity.map((s) => Prisma.sql`${s}::"bookings"."AnomalySeverity"`))})`,
      );
    }
    if (filters.ruleId) {
      conditions.push(Prisma.sql`a.rule_id = ${filters.ruleId}`);
    }
    if (filters.status && filters.status.length > 0) {
      conditions.push(
        Prisma.sql`a.status IN (${Prisma.join(filters.status.map((s) => Prisma.sql`${s}::"bookings"."AnomalyStatus"`))})`,
      );
    }
    if (filters.dateFrom) {
      conditions.push(Prisma.sql`a.detected_at >= ${filters.dateFrom}`);
    }
    if (filters.dateTo) {
      conditions.push(Prisma.sql`a.detected_at <= ${filters.dateTo}`);
    }
    if (filters.propertyId) {
      conditions.push(
        Prisma.sql`a.entity_type = 'property'::"bookings"."AnomalyEntityType" AND a.entity_id = ${filters.propertyId}::uuid`,
      );
    }
    if (filters.customerId) {
      conditions.push(
        Prisma.sql`a.entity_type = 'customer'::"bookings"."AnomalyEntityType" AND a.entity_id = ${filters.customerId}::uuid`,
      );
    }

    return conditions.length > 0 ? conditions : [Prisma.sql`TRUE`];
  }

  async findManyForAdmin(
    filters: AnomalyFilters,
    skip: number,
    take: number,
    sort: 'severity' | 'detectedAt' | 'status',
    order: 'asc' | 'desc',
  ): Promise<{ items: AnomalyListRow[]; total: number }> {
    const where = Prisma.join(this.buildConditions(filters), ' AND ');

    const sortColumn: Record<typeof sort, Prisma.Sql> = {
      severity: SEVERITY_RANK,
      detectedAt: Prisma.sql`a.detected_at`,
      status: Prisma.sql`a.status`,
    };
    const direction = order === 'asc' ? Prisma.sql`ASC` : Prisma.sql`DESC`;
    const orderBy = Prisma.sql`ORDER BY ${sortColumn[sort]} ${direction}, a.detected_at DESC`;

    const [items, countRows] = await Promise.all([
      this.prisma.$queryRaw<AnomalyListRow[]>(Prisma.sql`
        SELECT ${LIST_COLUMNS} ${FROM_JOINS} WHERE ${where} ${orderBy} LIMIT ${take} OFFSET ${skip}
      `),
      this.prisma.$queryRaw<Array<{ count: bigint }>>(Prisma.sql`
        SELECT COUNT(*) AS count ${FROM_JOINS} WHERE ${where}
      `),
    ]);

    return { items, total: Number(countRows[0]?.count ?? 0) };
  }

  async countUnresolved(): Promise<number> {
    return this.prisma.anomaly.count({
      where: { status: { in: [AnomalyStatus.detected, AnomalyStatus.investigating] } },
    });
  }

  async findDetailRow(id: string): Promise<AnomalyListRow | null> {
    const rows = await this.prisma.$queryRaw<AnomalyListRow[]>(Prisma.sql`
      SELECT ${LIST_COLUMNS} ${FROM_JOINS} WHERE a.id = ${id}::uuid
    `);
    return rows[0] ?? null;
  }

  async findBookingSummaries(ids: string[]): Promise<BookingSummaryRow[]> {
    if (ids.length === 0) return [];
    return this.prisma.$queryRaw<BookingSummaryRow[]>(Prisma.sql`
      SELECT id, booking_ref, status, total_amount_paise, check_in_at, check_out_at
      FROM bookings.bookings
      WHERE id IN (${Prisma.join(ids.map((bookingId) => Prisma.sql`${bookingId}::uuid`))})
    `);
  }

  findAdminActionsForBookings(bookingIds: string[]) {
    if (bookingIds.length === 0) return Promise.resolve([]);
    return this.prisma.bookingAdminAction.findMany({
      where: { bookingId: { in: bookingIds } },
      orderBy: { createdAt: 'desc' },
    });
  }

  findById(id: string): Promise<Anomaly | null> {
    return this.prisma.anomaly.findUnique({ where: { id } });
  }

  findUnresolvedByRule(
    ruleId: string,
    entityType: AnomalyEntityType,
    entityId: string,
  ): Promise<Anomaly | null> {
    return this.prisma.anomaly.findFirst({
      where: {
        ruleId,
        entityType,
        entityId,
        status: { in: [AnomalyStatus.detected, AnomalyStatus.investigating] },
      },
    });
  }

  create(data: Prisma.AnomalyCreateInput): Promise<Anomaly> {
    return this.prisma.anomaly.create({ data });
  }

  async updateIfStatus(
    id: string,
    fromStatuses: AnomalyStatus[],
    data: Prisma.AnomalyUpdateInput,
  ): Promise<Anomaly | null> {
    const result = await this.prisma.anomaly.updateMany({
      where: { id, status: { in: fromStatuses } },
      data,
    });
    if (result.count === 0) return null;
    return this.prisma.anomaly.findUnique({ where: { id } });
  }

  // --- Rule engine candidate queries (M5B spec §2.2) ---

  findHighCancellationRateCandidates(windowStart: Date) {
    return this.prisma.$queryRaw<
      Array<{ entity_id: string; entity_label: string | null; total_count: number; cancelled_count: number; sample_ids: string[] }>
    >(Prisma.sql`
      SELECT b.property_id AS entity_id, p.name AS entity_label,
        COUNT(*)::int AS total_count,
        COUNT(*) FILTER (WHERE b.status IN ('cancelled', 'voided'))::int AS cancelled_count,
        COALESCE((ARRAY_AGG(b.id ORDER BY b.created_at DESC) FILTER (WHERE b.status IN ('cancelled', 'voided')))[1:10], '{}') AS sample_ids
      FROM bookings.bookings b
      LEFT JOIN properties.properties p ON p.id = b.property_id
      WHERE b.created_at >= ${windowStart}
      GROUP BY b.property_id, p.name
      HAVING COUNT(*) >= 5
    `);
  }

  findPaymentFailureSpikeCandidates(windowStart: Date) {
    return this.prisma.$queryRaw<
      Array<{ entity_id: string; entity_label: string | null; failed_count: number; sample_ids: string[] }>
    >(Prisma.sql`
      SELECT b.property_id AS entity_id, p.name AS entity_label,
        COUNT(*)::int AS failed_count,
        COALESCE((ARRAY_AGG(b.id ORDER BY b.created_at DESC))[1:10], '{}') AS sample_ids
      FROM bookings.bookings b
      LEFT JOIN properties.properties p ON p.id = b.property_id
      WHERE b.payment_status = 'failed'::"bookings"."PaymentStatus" AND b.created_at >= ${windowStart}
      GROUP BY b.property_id, p.name
      HAVING COUNT(*) > 5
    `);
  }

  findOverbookingPairs() {
    return this.prisma.$queryRaw<
      Array<{
        booking_id_a: string;
        booking_id_b: string;
        booking_ref_a: string;
        booking_ref_b: string;
        room_type_id: string;
        overlap_start: Date;
        overlap_end: Date;
      }>
    >(Prisma.sql`
      SELECT b1.id AS booking_id_a, b2.id AS booking_id_b,
        b1.booking_ref AS booking_ref_a, b2.booking_ref AS booking_ref_b,
        b1.room_type_id,
        GREATEST(b1.check_in_at, b2.check_in_at) AS overlap_start,
        LEAST(b1.check_out_at, b2.check_out_at) AS overlap_end
      FROM bookings.bookings b1
      JOIN bookings.bookings b2 ON b1.room_type_id = b2.room_type_id AND b1.id < b2.id
      WHERE b1.status IN ('confirmed', 'checked_in') AND b2.status IN ('confirmed', 'checked_in')
        AND b1.check_in_at < b2.check_out_at AND b2.check_in_at < b1.check_out_at
    `);
  }

  findBookingVelocityCandidates(windowStart: Date) {
    return this.prisma.$queryRaw<
      Array<{ entity_id: string; entity_label: string | null; booking_count: number; booking_ids: string[] }>
    >(Prisma.sql`
      SELECT b.guest_id AS entity_id, u.phone AS entity_label,
        COUNT(*)::int AS booking_count,
        COALESCE((ARRAY_AGG(b.id ORDER BY b.created_at DESC))[1:10], '{}') AS booking_ids
      FROM bookings.bookings b
      LEFT JOIN auth.users u ON u.id = b.guest_id
      WHERE b.created_at >= ${windowStart}
      GROUP BY b.guest_id, u.phone
      HAVING COUNT(*) > 5
    `);
  }

  findNoShowClusterCandidates(windowStart: Date) {
    return this.prisma.$queryRaw<
      Array<{ entity_id: string; entity_label: string | null; no_show_count: number; booking_ids: string[] }>
    >(Prisma.sql`
      SELECT b.property_id AS entity_id, p.name AS entity_label,
        COUNT(*)::int AS no_show_count,
        COALESCE((ARRAY_AGG(b.id ORDER BY b.no_show_at DESC))[1:10], '{}') AS booking_ids
      FROM bookings.bookings b
      LEFT JOIN properties.properties p ON p.id = b.property_id
      WHERE b.status = 'no_show'::"bookings"."BookingStatus" AND b.no_show_at >= ${windowStart}
      GROUP BY b.property_id, p.name
      HAVING COUNT(*) > 3
    `);
  }

  findLateNightSpikeCandidates(windowStart: Date) {
    return this.prisma.$queryRaw<
      Array<{ entity_id: string; entity_label: string | null; booking_count: number; booking_ids: string[] }>
    >(Prisma.sql`
      SELECT b.property_id AS entity_id, p.name AS entity_label,
        COUNT(*)::int AS booking_count,
        COALESCE((ARRAY_AGG(b.id ORDER BY b.created_at DESC))[1:10], '{}') AS booking_ids
      FROM bookings.bookings b
      LEFT JOIN properties.properties p ON p.id = b.property_id
      WHERE b.created_at >= ${windowStart}
        AND (EXTRACT(HOUR FROM b.created_at) >= 23 OR EXTRACT(HOUR FROM b.created_at) < 5)
      GROUP BY b.property_id, p.name
      HAVING COUNT(*) > 10
    `);
  }

  findRefundAbuseCandidates(windowStart: Date) {
    return this.prisma.$queryRaw<
      Array<{ entity_id: string; entity_label: string | null; total_count: number; refunded_count: number; sample_ids: string[] }>
    >(Prisma.sql`
      SELECT b.guest_id AS entity_id, u.phone AS entity_label,
        COUNT(*)::int AS total_count,
        COUNT(*) FILTER (WHERE b.refund_amount_paise > 0)::int AS refunded_count,
        COALESCE((ARRAY_AGG(b.id ORDER BY b.created_at DESC) FILTER (WHERE b.refund_amount_paise > 0))[1:10], '{}') AS sample_ids
      FROM bookings.bookings b
      LEFT JOIN auth.users u ON u.id = b.guest_id
      WHERE b.created_at >= ${windowStart}
      GROUP BY b.guest_id, u.phone
      HAVING COUNT(*) >= 5
    `);
  }

  // M6 spec §5: ANO-011 - properties with > 5 guest-favour dispute
  // resolutions in the last 30 days.
  findGuestFavourDisputeCandidates(windowStart: Date) {
    return this.prisma.$queryRaw<
      Array<{ entity_id: string; entity_label: string | null; dispute_count: number; sample_ids: string[] }>
    >(Prisma.sql`
      SELECT d.property_id AS entity_id, p.name AS entity_label,
        COUNT(*)::int AS dispute_count,
        COALESCE((ARRAY_AGG(d.id ORDER BY d.resolved_at DESC))[1:10], '{}') AS sample_ids
      FROM bookings.disputes d
      LEFT JOIN properties.properties p ON p.id = d.property_id
      WHERE d.status IN ('resolved_guest', 'resolved_partial', 'resolved_wallet_credit', 'closed_no_response')
        AND d.resolved_at >= ${windowStart}
      GROUP BY d.property_id, p.name
      HAVING COUNT(*) > 5
    `);
  }

  findFlaggedBookings() {
    return this.prisma.$queryRaw<
      Array<{
        id: string;
        booking_ref: string;
        property_id: string;
        flag_type: string | null;
        flag_notes: string | null;
      }>
    >(Prisma.sql`
      SELECT id, booking_ref, property_id, flag_type, flag_notes
      FROM bookings.bookings
      WHERE is_flagged = true
    `);
  }
}

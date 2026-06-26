import { Injectable } from '@nestjs/common';
import { Prisma, Review, ReviewAuditLog, ReviewFlag, ReviewStatus } from '@prisma/client';
import { PrismaService } from '../database/prisma.service';

export interface ReviewListRow {
  id: string;
  booking_id: string;
  property_id: string;
  guest_id: string;
  owner_id: string;
  score_overall: number;
  score_cleanliness: number;
  score_amenities: number;
  score_accuracy: number;
  score_value: number;
  score_checkin: number;
  display_score: string;
  review_text: string | null;
  photo_urls: string[];
  status: ReviewStatus;
  owner_reply: string | null;
  owner_replied_at: Date | null;
  reply_window_end: Date | null;
  window_opens_at: Date;
  expires_at: Date;
  submitted_at: Date | null;
  published_at: Date | null;
  created_at: Date;
  booking_ref: string | null;
  property_name: string | null;
  guest_name: string | null;
}

export interface RatingAggRow {
  rating_count: bigint;
  rating_avg: string | null;
  dim_cleanliness: string | null;
  dim_amenities: string | null;
  dim_accuracy: string | null;
  dim_value: string | null;
  dim_checkin: string | null;
  star_1: bigint;
  star_2: bigint;
  star_3: bigint;
  star_4: bigint;
  star_5: bigint;
}

@Injectable()
export class ReviewsRepository {
  constructor(private readonly prisma: PrismaService) {}

  findById(id: string): Promise<Review | null> {
    return this.prisma.review.findUnique({ where: { id }, include: { flags: true, auditLog: true } });
  }

  findByBookingId(bookingId: string): Promise<Review | null> {
    return this.prisma.review.findUnique({ where: { bookingId } });
  }

  create(data: Prisma.ReviewCreateInput): Promise<Review> {
    return this.prisma.review.create({ data });
  }

  update(id: string, data: Prisma.ReviewUpdateInput): Promise<Review> {
    return this.prisma.review.update({ where: { id }, data });
  }

  createFlag(data: Prisma.ReviewFlagCreateInput): Promise<ReviewFlag> {
    return this.prisma.reviewFlag.create({ data });
  }

  createAuditEntry(data: Prisma.ReviewAuditLogCreateInput): Promise<ReviewAuditLog> {
    return this.prisma.reviewAuditLog.create({ data });
  }

  countOwnerFlagsThisWeek(ownerId: string): Promise<number> {
    const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    return this.prisma.reviewFlag.count({
      where: { flaggedBy: ownerId, flagRole: 'owner', createdAt: { gte: weekAgo } },
    });
  }

  findOwnerFlagForReview(reviewId: string, ownerId: string): Promise<ReviewFlag | null> {
    return this.prisma.reviewFlag.findFirst({
      where: { reviewId, flaggedBy: ownerId, flagRole: 'owner' },
    });
  }

  getAuditLog(reviewId: string): Promise<ReviewAuditLog[]> {
    return this.prisma.reviewAuditLog.findMany({
      where: { reviewId },
      orderBy: { createdAt: 'asc' },
    });
  }

  async listPublicForProperty(
    propertyId: string,
    page: number,
    limit: number,
    sort: 'recent' | 'highest' | 'lowest',
    scoreFilter?: number,
    withPhotos?: boolean,
    withReply?: boolean,
  ): Promise<{ items: ReviewListRow[]; total: number }> {
    const conditions: Prisma.Sql[] = [
      Prisma.sql`r.property_id = ${propertyId}::uuid`,
      Prisma.sql`r.status = 'published'::"reviews"."ReviewStatus"`,
    ];
    if (scoreFilter) conditions.push(Prisma.sql`r.score_overall = ${scoreFilter}`);
    if (withPhotos) conditions.push(Prisma.sql`array_length(r.photo_urls, 1) > 0`);
    if (withReply) conditions.push(Prisma.sql`r.owner_reply IS NOT NULL`);

    const where = Prisma.sql`WHERE ${Prisma.join(conditions, ' AND ')}`;

    const orderBy =
      sort === 'highest'
        ? Prisma.sql`r.display_score DESC`
        : sort === 'lowest'
          ? Prisma.sql`r.display_score ASC`
          : Prisma.sql`r.published_at DESC`;

    const offset = (page - 1) * limit;

    const [items, countResult] = await Promise.all([
      this.prisma.$queryRaw<ReviewListRow[]>`
        SELECT r.id, r.booking_id, r.property_id, r.guest_id, r.owner_id,
               r.score_overall, r.score_cleanliness, r.score_amenities,
               r.score_accuracy, r.score_value, r.score_checkin,
               r.display_score::text, r.review_text, r.photo_urls, r.status,
               r.owner_reply, r.owner_replied_at, r.reply_window_end,
               r.window_opens_at, r.expires_at, r.submitted_at, r.published_at,
               r.created_at,
               b.booking_ref,
               p.name AS property_name,
               u.name AS guest_name
        FROM reviews.reviews r
        LEFT JOIN bookings.bookings b ON b.id = r.booking_id
        LEFT JOIN properties.properties p ON p.id = r.property_id
        LEFT JOIN auth.users u ON u.id = r.guest_id
        ${where}
        ORDER BY ${orderBy}
        LIMIT ${limit} OFFSET ${offset}
      `,
      this.prisma.$queryRaw<[{ count: bigint }]>`
        SELECT COUNT(*) FROM reviews.reviews r ${where}
      `,
    ]);

    return { items, total: Number(countResult[0].count) };
  }

  async listForAdmin(
    page: number,
    limit: number,
    status?: ReviewStatus,
    propertyId?: string,
    scoreMin?: number,
    scoreMax?: number,
  ): Promise<{ items: ReviewListRow[]; total: number }> {
    const conditions: Prisma.Sql[] = [];
    if (status) conditions.push(Prisma.sql`r.status = ${status}::"reviews"."ReviewStatus"`);
    if (propertyId) conditions.push(Prisma.sql`r.property_id = ${propertyId}::uuid`);
    if (scoreMin) conditions.push(Prisma.sql`r.score_overall >= ${scoreMin}`);
    if (scoreMax) conditions.push(Prisma.sql`r.score_overall <= ${scoreMax}`);

    const where =
      conditions.length > 0
        ? Prisma.sql`WHERE ${Prisma.join(conditions, ' AND ')}`
        : Prisma.sql``;

    const offset = (page - 1) * limit;

    const [items, countResult] = await Promise.all([
      this.prisma.$queryRaw<ReviewListRow[]>`
        SELECT r.id, r.booking_id, r.property_id, r.guest_id, r.owner_id,
               r.score_overall, r.score_cleanliness, r.score_amenities,
               r.score_accuracy, r.score_value, r.score_checkin,
               r.display_score::text, r.review_text, r.photo_urls, r.status,
               r.owner_reply, r.owner_replied_at, r.reply_window_end,
               r.window_opens_at, r.expires_at, r.submitted_at, r.published_at,
               r.created_at,
               b.booking_ref,
               p.name AS property_name,
               u.name AS guest_name
        FROM reviews.reviews r
        LEFT JOIN bookings.bookings b ON b.id = r.booking_id
        LEFT JOIN properties.properties p ON p.id = r.property_id
        LEFT JOIN auth.users u ON u.id = r.guest_id
        ${where}
        ORDER BY r.created_at DESC
        LIMIT ${limit} OFFSET ${offset}
      `,
      this.prisma.$queryRaw<[{ count: bigint }]>`
        SELECT COUNT(*) FROM reviews.reviews r ${where}
      `,
    ]);

    return { items, total: Number(countResult[0].count) };
  }

  async listForOwnerProperty(
    propertyId: string,
    page: number,
    limit: number,
  ): Promise<{ items: ReviewListRow[]; total: number }> {
    const offset = (page - 1) * limit;
    const [items, countResult] = await Promise.all([
      this.prisma.$queryRaw<ReviewListRow[]>`
        SELECT r.id, r.booking_id, r.property_id, r.guest_id, r.owner_id,
               r.score_overall, r.score_cleanliness, r.score_amenities,
               r.score_accuracy, r.score_value, r.score_checkin,
               r.display_score::text, r.review_text, r.photo_urls, r.status,
               r.owner_reply, r.owner_replied_at, r.reply_window_end,
               r.window_opens_at, r.expires_at, r.submitted_at, r.published_at,
               r.created_at,
               b.booking_ref,
               p.name AS property_name,
               u.name AS guest_name
        FROM reviews.reviews r
        LEFT JOIN bookings.bookings b ON b.id = r.booking_id
        LEFT JOIN properties.properties p ON p.id = r.property_id
        LEFT JOIN auth.users u ON u.id = r.guest_id
        WHERE r.property_id = ${propertyId}::uuid
          AND r.status IN ('published'::"reviews"."ReviewStatus", 'flagged'::"reviews"."ReviewStatus")
        ORDER BY r.created_at DESC
        LIMIT ${limit} OFFSET ${offset}
      `,
      this.prisma.$queryRaw<[{ count: bigint }]>`
        SELECT COUNT(*) FROM reviews.reviews r
        WHERE r.property_id = ${propertyId}::uuid
          AND r.status IN ('published'::"reviews"."ReviewStatus", 'flagged'::"reviews"."ReviewStatus")
      `,
    ]);

    return { items, total: Number(countResult[0].count) };
  }

  computePropertyRating(propertyId: string): Promise<RatingAggRow[]> {
    return this.prisma.$queryRaw<RatingAggRow[]>`
      SELECT
        COUNT(*)                                                    AS rating_count,
        AVG(display_score)::text                                    AS rating_avg,
        AVG(score_cleanliness)::text                               AS dim_cleanliness,
        AVG(score_amenities)::text                                  AS dim_amenities,
        AVG(score_accuracy)::text                                   AS dim_accuracy,
        AVG(score_value)::text                                      AS dim_value,
        AVG(score_checkin)::text                                    AS dim_checkin,
        COUNT(*) FILTER (WHERE score_overall = 1)                   AS star_1,
        COUNT(*) FILTER (WHERE score_overall = 2)                   AS star_2,
        COUNT(*) FILTER (WHERE score_overall = 3)                   AS star_3,
        COUNT(*) FILTER (WHERE score_overall = 4)                   AS star_4,
        COUNT(*) FILTER (WHERE score_overall = 5)                   AS star_5
      FROM reviews.reviews
      WHERE property_id = ${propertyId}::uuid AND status = 'published'::"reviews"."ReviewStatus"
    `;
  }

  countFlagged(): Promise<number> {
    return this.prisma.review.count({ where: { status: ReviewStatus.flagged } });
  }

  findPendingWindowsToOpen(): Promise<
    Array<{ bookingId: string; propertyId: string; guestId: string; ownerId: string; checkoutAt: Date }>
  > {
    return this.prisma.$queryRaw`
      SELECT b.id AS "bookingId", b.property_id AS "propertyId",
             b.guest_id AS "guestId", b.owner_id AS "ownerId",
             b.checkout_at AS "checkoutAt"
      FROM bookings.bookings b
      WHERE b.status = 'completed'::"bookings"."BookingStatus"
        AND NOT EXISTS (SELECT 1 FROM reviews.reviews r WHERE r.booking_id = b.id)
        AND b.checkout_at + INTERVAL '2 hours' <= NOW()
    `;
  }

  bulkInsertPendingReviews(
    rows: Array<{
      bookingId: string;
      propertyId: string;
      guestId: string;
      ownerId: string;
      windowOpensAt: Date;
      expiresAt: Date;
    }>,
  ): Promise<number> {
    if (rows.length === 0) return Promise.resolve(0);
    return this.prisma.$executeRaw`
      INSERT INTO reviews.reviews
        (id, booking_id, property_id, guest_id, owner_id,
         score_overall, score_cleanliness, score_amenities,
         score_accuracy, score_value, score_checkin, display_score,
         photo_urls, status, reply_reminder_sent,
         window_opens_at, expires_at, created_at, updated_at)
      SELECT gen_random_uuid(), b.booking_id, b.property_id, b.guest_id, b.owner_id,
             0, 0, 0, 0, 0, 0, 0.00,
             '{}', 'pending'::"reviews"."ReviewStatus", false,
             b.window_opens_at, b.expires_at, NOW(), NOW()
      FROM (VALUES ${Prisma.join(
        rows.map(
          (r) =>
            Prisma.sql`(${r.bookingId}::uuid, ${r.propertyId}::uuid, ${r.guestId}::uuid, ${r.ownerId}::uuid, ${r.windowOpensAt}, ${r.expiresAt})`,
        ),
      )}) AS b(booking_id, property_id, guest_id, owner_id, window_opens_at, expires_at)
      ON CONFLICT (booking_id) DO NOTHING
    `;
  }

  findPromptable(): Promise<Review[]> {
    return this.prisma.review.findMany({
      where: {
        status: ReviewStatus.pending,
        windowOpensAt: { lte: new Date() },
        promptSentAt: null,
        submittedAt: null,
      },
    });
  }

  findExpired(): Promise<Review[]> {
    return this.prisma.review.findMany({
      where: {
        status: ReviewStatus.pending,
        expiresAt: { lt: new Date() },
        submittedAt: null,
      },
    });
  }

  findReplyRemindable(): Promise<Review[]> {
    const now = new Date();
    const in24h = new Date(now.getTime() + 24 * 60 * 60 * 1000);
    return this.prisma.review.findMany({
      where: {
        status: ReviewStatus.published,
        ownerReply: null,
        replyReminderSent: false,
        replyWindowEnd: { gte: now, lte: in24h },
      },
    });
  }
}

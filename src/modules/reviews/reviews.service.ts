import {
  ConflictException,
  ForbiddenException,
  GoneException,
  HttpException,
  HttpStatus,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, Review, ReviewAuditLog, ReviewStatus } from '@prisma/client';
import { Decimal } from '@prisma/client/runtime/library';
import { DOMAIN_EVENTS } from '../../common/events/domain-events';
import { TypedEventEmitter } from '../../common/events/typed-event-emitter.service';
import { BookingsRepository } from '../bookings/bookings.repository';
import { NotificationsRepository } from '../notifications/notifications.repository';
import { NotificationType } from '@prisma/client';
import { PrismaService } from '../database/prisma.service';
import { ListAdminReviewsQueryDto, ListReviewsQueryDto } from './dto/list-reviews-query.dto';
import { ModerateAction } from './dto/moderate-review.dto';
import { ReviewListRow, ReviewsRepository } from './reviews.repository';
import { SubmitReviewDto } from './dto/submit-review.dto';

const HOUR_MS = 60 * 60 * 1000;
const REPLY_WINDOW_MS = 96 * HOUR_MS;
const OWNER_FLAG_WEEKLY_LIMIT = 3;
const MIN_REVIEWS_FOR_DISPLAY = 5;

const PII_PATTERNS = [
  /\+?91?\s*[6-9]\d{9}/,
  /\S+@\S+\.\S+/,
  /\d{4}\s?\d{4}\s?\d{4}/,
];

const PROFANITY_WORDS: string[] = (process.env.PROFANITY_WORDS ?? '')
  .split(',')
  .map((w) => w.trim().toLowerCase())
  .filter(Boolean);

function computeDisplayScore(dto: {
  scoreCleanliness: number;
  scoreAmenities: number;
  scoreAccuracy: number;
  scoreValue: number;
  scoreCheckin: number;
}): Decimal {
  const raw =
    dto.scoreCleanliness * 0.25 +
    dto.scoreAmenities * 0.2 +
    dto.scoreAccuracy * 0.2 +
    dto.scoreValue * 0.2 +
    dto.scoreCheckin * 0.15;
  return new Decimal(Math.round(raw * 100) / 100);
}

function hasPII(text: string): boolean {
  return PII_PATTERNS.some((re) => re.test(text));
}

function hasProfanity(text: string): boolean {
  if (PROFANITY_WORDS.length === 0) return false;
  const lower = text.toLowerCase();
  return PROFANITY_WORDS.some((w) => lower.includes(w));
}

export interface PendingReviewItem {
  bookingId: string;
  bookingRef: string | null;
  propertyName: string | null;
  checkOutAt: Date;
  windowOpensAt: Date;
  expiresAt: Date;
  expiresInSeconds: number;
}

export interface PropertyRatingSummary {
  ratingAvg: number | null;
  ratingCount: number;
  breakdown: Record<'1' | '2' | '3' | '4' | '5', number>;
  dimensions: {
    cleanliness: number;
    amenities: number;
    accuracy: number;
    value: number;
    checkin: number;
  };
  meetsThreshold: boolean;
}

export interface ReviewListResult {
  items: ReviewListRow[];
  total: number;
  page: number;
  limit: number;
}

@Injectable()
export class ReviewsService {
  constructor(
    private readonly repo: ReviewsRepository,
    private readonly bookingsRepo: BookingsRepository,
    private readonly notifications: NotificationsRepository,
    private readonly events: TypedEventEmitter,
    private readonly prisma: PrismaService,
  ) {}

  // ─── Guest: Submit ────────────────────────────────────────────────────────

  async submitReview(guestId: string, dto: SubmitReviewDto): Promise<Review> {
    const booking = await this.bookingsRepo.findById(dto.bookingId);
    if (!booking || booking.guestId !== guestId) {
      throw new ForbiddenException('BOOKING_NOT_ELIGIBLE');
    }
    if (booking.status !== 'completed') {
      throw new ForbiddenException('BOOKING_NOT_ELIGIBLE');
    }

    const existing = await this.repo.findByBookingId(dto.bookingId);
    if (existing?.submittedAt) {
      throw new ConflictException('REVIEW_ALREADY_EXISTS');
    }

    const now = new Date();

    if (!existing) {
      throw new ForbiddenException('REVIEW_WINDOW_NOT_OPEN');
    }

    if (now < existing.windowOpensAt) {
      throw new ForbiddenException('REVIEW_WINDOW_NOT_OPEN');
    }

    if (now > existing.expiresAt) {
      throw new GoneException('REVIEW_WINDOW_EXPIRED');
    }

    const displayScore = computeDisplayScore(dto);
    const text = dto.reviewText ?? null;

    const autoFlagged =
      text !== null && (hasPII(text) || hasProfanity(text));

    const newStatus: ReviewStatus = autoFlagged ? ReviewStatus.flagged : ReviewStatus.published;

    const updated = await this.repo.update(existing.id, {
      scoreOverall: dto.scoreOverall,
      scoreCleanliness: dto.scoreCleanliness,
      scoreAmenities: dto.scoreAmenities,
      scoreAccuracy: dto.scoreAccuracy,
      scoreValue: dto.scoreValue,
      scoreCheckin: dto.scoreCheckin,
      displayScore,
      reviewText: text,
      photoUrls: dto.photoUrls ?? [],
      status: newStatus,
      submittedAt: now,
      publishedAt: autoFlagged ? null : now,
      replyWindowEnd: autoFlagged ? null : new Date(now.getTime() + REPLY_WINDOW_MS),
    });

    await this.repo.createAuditEntry({
      review: { connect: { id: existing.id } },
      actor: guestId,
      actorRole: 'guest',
      action: 'submitted',
      fromStatus: ReviewStatus.pending,
      toStatus: newStatus,
    });

    if (autoFlagged) {
      await this.repo.createFlag({
        review: { connect: { id: existing.id } },
        flaggedBy: 'system',
        flagRole: 'system',
        reason: 'Auto-flagged: PII or profanity detected',
      });
      this.events.emit(DOMAIN_EVENTS.REVIEW_FLAGGED_ADMIN, {
        reviewId: existing.id,
        propertyId: existing.propertyId,
        flagRole: 'system',
        reason: 'Auto-flagged: PII or profanity detected',
      });
    } else {
      await this.recalculatePropertyRating(existing.propertyId);
      this.events.emit(DOMAIN_EVENTS.REVIEW_NEW_ON_PROPERTY, {
        reviewId: existing.id,
        propertyId: existing.propertyId,
        ownerId: existing.ownerId,
        scoreOverall: dto.scoreOverall,
      });
      await this.notifications.create({
        ownerId: existing.ownerId,
        propertyId: existing.propertyId,
        type: NotificationType.review_new_on_property,
        title: 'New review on your property',
        body: `A guest left a ${dto.scoreOverall}-star review. Reply within 96 hours to boost guest trust.`,
        actionUrl: '/owner/reviews',
      });
    }

    return updated;
  }

  // ─── Guest: Pending windows ───────────────────────────────────────────────

  async getPendingReviews(guestId: string): Promise<{ bookings: PendingReviewItem[] }> {
    const rows = await this.prisma.$queryRaw<
      Array<{
        bookingId: string;
        bookingRef: string | null;
        propertyName: string | null;
        checkOutAt: Date;
        windowOpensAt: Date;
        expiresAt: Date;
      }>
    >`
      SELECT r.booking_id AS "bookingId",
             b.booking_ref AS "bookingRef",
             p.name AS "propertyName",
             b.checked_out_at AS "checkOutAt",
             r.window_opens_at AS "windowOpensAt",
             r.expires_at AS "expiresAt"
      FROM reviews.reviews r
      JOIN bookings.bookings b ON b.id = r.booking_id
      LEFT JOIN properties.properties p ON p.id = r.property_id
      WHERE r.guest_id = ${guestId}::uuid
        AND r.status = 'pending'::"reviews"."ReviewStatus"
        AND r.submitted_at IS NULL
        AND r.expires_at > NOW()
      ORDER BY r.expires_at ASC
    `;

    const now = Date.now();
    return {
      bookings: rows.map((row) => ({
        ...row,
        expiresInSeconds: Math.max(0, Math.floor((row.expiresAt.getTime() - now) / 1000)),
      })),
    };
  }

  // ─── Guest: My reviews ────────────────────────────────────────────────────

  async getMyReviews(guestId: string): Promise<ReviewListResult> {
    const { items } = await this.repo.listForAdmin(1, 50, undefined, undefined, undefined, undefined);
    const mine = items.filter((r) => r.guest_id === guestId);
    return { items: mine, total: mine.length, page: 1, limit: 50 };
  }

  // ─── Guest: Report a published review ────────────────────────────────────

  async reportReview(reviewId: string, guestId: string, reason?: string): Promise<void> {
    const review = await this.findOrThrow(reviewId);
    if (review.status !== ReviewStatus.published) {
      throw new ForbiddenException('Review is not published');
    }

    await this.repo.createFlag({
      review: { connect: { id: reviewId } },
      flaggedBy: guestId,
      flagRole: 'guest',
      reason: reason ?? null,
    });

    await this.repo.update(reviewId, { status: ReviewStatus.flagged });
    await this.repo.createAuditEntry({
      review: { connect: { id: reviewId } },
      actor: guestId,
      actorRole: 'guest',
      action: 'flag_added',
      fromStatus: ReviewStatus.published,
      toStatus: ReviewStatus.flagged,
      reason,
    });
  }

  // ─── Public: Property reviews ─────────────────────────────────────────────

  async getPublicReviews(propertyId: string, query: ListReviewsQueryDto): Promise<ReviewListResult> {
    const { items, total } = await this.repo.listPublicForProperty(
      propertyId,
      query.page,
      query.limit,
      query.sort as 'recent' | 'highest' | 'lowest',
      query.scoreFilter,
      query.withPhotos,
      query.withReply,
    );
    return { items, total, page: query.page, limit: query.limit };
  }

  // ─── Public: Property rating summary ─────────────────────────────────────

  async getPropertySummary(propertyId: string): Promise<PropertyRatingSummary> {
    const [agg] = await this.repo.computePropertyRating(propertyId);
    if (!agg) {
      return {
        ratingAvg: null,
        ratingCount: 0,
        breakdown: { '1': 0, '2': 0, '3': 0, '4': 0, '5': 0 },
        dimensions: { cleanliness: 0, amenities: 0, accuracy: 0, value: 0, checkin: 0 },
        meetsThreshold: false,
      };
    }
    const count = Number(agg.rating_count);
    const meetsThreshold = count >= MIN_REVIEWS_FOR_DISPLAY;
    return {
      ratingAvg: meetsThreshold && agg.rating_avg ? parseFloat(agg.rating_avg) : null,
      ratingCount: count,
      breakdown: {
        '1': Number(agg.star_1),
        '2': Number(agg.star_2),
        '3': Number(agg.star_3),
        '4': Number(agg.star_4),
        '5': Number(agg.star_5),
      },
      dimensions: {
        cleanliness: agg.dim_cleanliness ? parseFloat(agg.dim_cleanliness) : 0,
        amenities: agg.dim_amenities ? parseFloat(agg.dim_amenities) : 0,
        accuracy: agg.dim_accuracy ? parseFloat(agg.dim_accuracy) : 0,
        value: agg.dim_value ? parseFloat(agg.dim_value) : 0,
        checkin: agg.dim_checkin ? parseFloat(agg.dim_checkin) : 0,
      },
      meetsThreshold,
    };
  }

  // ─── Owner: Reply ─────────────────────────────────────────────────────────

  async ownerReply(reviewId: string, ownerId: string, reply: string): Promise<Review> {
    const review = await this.findOrThrow(reviewId);

    if (review.ownerId !== ownerId) throw new ForbiddenException('Not your property');
    if (review.status !== ReviewStatus.published) throw new ForbiddenException('Review is not published');
    if (review.ownerReply) throw new ConflictException('REPLY_ALREADY_EXISTS');

    const now = new Date();
    if (review.replyWindowEnd && now > review.replyWindowEnd) {
      throw new ForbiddenException('REPLY_WINDOW_EXPIRED');
    }

    const updated = await this.repo.update(reviewId, {
      ownerReply: reply,
      ownerRepliedAt: now,
    });

    await this.repo.createAuditEntry({
      review: { connect: { id: reviewId } },
      actor: ownerId,
      actorRole: 'owner',
      action: 'replied',
    });

    return updated;
  }

  // ─── Owner: Flag ──────────────────────────────────────────────────────────

  async ownerFlag(reviewId: string, ownerId: string, reason?: string): Promise<void> {
    const review = await this.findOrThrow(reviewId);
    if (review.ownerId !== ownerId) throw new ForbiddenException('Not your property');

    const alreadyFlagged = await this.repo.findOwnerFlagForReview(reviewId, ownerId);
    if (alreadyFlagged) throw new ConflictException('ALREADY_FLAGGED_BY_OWNER');

    const weeklyCount = await this.repo.countOwnerFlagsThisWeek(ownerId);
    if (weeklyCount >= OWNER_FLAG_WEEKLY_LIMIT) {
      throw new HttpException('Owner flag rate limit reached (3/week)', HttpStatus.TOO_MANY_REQUESTS);
    }

    await this.repo.createFlag({
      review: { connect: { id: reviewId } },
      flaggedBy: ownerId,
      flagRole: 'owner',
      reason: reason ?? null,
    });

    await this.repo.update(reviewId, { status: ReviewStatus.flagged });
    await this.repo.createAuditEntry({
      review: { connect: { id: reviewId } },
      actor: ownerId,
      actorRole: 'owner',
      action: 'flag_added',
      fromStatus: review.status,
      toStatus: ReviewStatus.flagged,
      reason,
    });
  }

  // ─── Owner: List for property ─────────────────────────────────────────────

  async listForOwner(propertyId: string, page: number, limit: number): Promise<ReviewListResult> {
    const { items, total } = await this.repo.listForOwnerProperty(propertyId, page, limit);
    return { items, total, page, limit };
  }

  // ─── Admin: List all ──────────────────────────────────────────────────────

  async adminListReviews(query: ListAdminReviewsQueryDto): Promise<ReviewListResult> {
    const { items, total } = await this.repo.listForAdmin(
      query.page,
      query.limit,
      query.status,
      query.propertyId,
      query.scoreMin,
      query.scoreMax,
    );
    return { items, total, page: query.page, limit: query.limit };
  }

  async adminListFlagged(page: number, limit: number): Promise<ReviewListResult> {
    const { items, total } = await this.repo.listForAdmin(page, limit, ReviewStatus.flagged);
    return { items, total, page, limit };
  }

  async adminFlaggedCount(): Promise<{ count: number }> {
    const count = await this.repo.countFlagged();
    return { count };
  }

  // ─── Admin: Moderate ──────────────────────────────────────────────────────

  async adminModerate(reviewId: string, adminId: string, action: ModerateAction, reason?: string): Promise<Review> {
    const review = await this.findOrThrow(reviewId);

    if (review.status !== ReviewStatus.flagged) {
      throw new ForbiddenException('Review is not in flagged state');
    }

    const now = new Date();
    const newStatus = action === ModerateAction.PUBLISH ? ReviewStatus.published : ReviewStatus.removed;

    const updateData: Prisma.ReviewUpdateInput = {
      status: newStatus,
      ...(action === ModerateAction.PUBLISH
        ? {
            publishedAt: review.publishedAt ?? now,
            replyWindowEnd: new Date(now.getTime() + REPLY_WINDOW_MS),
          }
        : {}),
    };

    const updated = await this.repo.update(reviewId, updateData);

    await this.repo.createAuditEntry({
      review: { connect: { id: reviewId } },
      actor: adminId,
      actorRole: 'admin',
      action: action === ModerateAction.PUBLISH ? 'published' : 'removed',
      fromStatus: ReviewStatus.flagged,
      toStatus: newStatus,
      reason,
    });

    if (action === ModerateAction.PUBLISH) {
      await this.recalculatePropertyRating(review.propertyId);
    }

    return updated;
  }

  // ─── Admin: Delete ────────────────────────────────────────────────────────

  async adminDeleteReview(reviewId: string, adminId: string, reason: string): Promise<void> {
    const review = await this.findOrThrow(reviewId);
    const wasPublished = review.status === ReviewStatus.published;

    await this.repo.update(reviewId, { status: ReviewStatus.removed });
    await this.repo.createAuditEntry({
      review: { connect: { id: reviewId } },
      actor: adminId,
      actorRole: 'admin',
      action: 'removed',
      fromStatus: review.status,
      toStatus: ReviewStatus.removed,
      reason,
    });

    if (wasPublished) {
      await this.recalculatePropertyRating(review.propertyId);
    }
  }

  // ─── Admin: Audit log ─────────────────────────────────────────────────────

  async adminAuditLog(reviewId: string): Promise<ReviewAuditLog[]> {
    await this.findOrThrow(reviewId);
    return this.repo.getAuditLog(reviewId);
  }

  // ─── Rating recalculation ─────────────────────────────────────────────────

  async recalculatePropertyRating(propertyId: string): Promise<void> {
    const [agg] = await this.repo.computePropertyRating(propertyId);
    if (!agg) return;

    const count = Number(agg.rating_count);
    const avg = count >= MIN_REVIEWS_FOR_DISPLAY && agg.rating_avg ? parseFloat(agg.rating_avg) : null;

    await this.prisma.property.update({
      where: { id: propertyId },
      data: {
        ratingAvg: avg,
        ratingCount: count,
        ratingBreakdown: {
          '1': Number(agg.star_1),
          '2': Number(agg.star_2),
          '3': Number(agg.star_3),
          '4': Number(agg.star_4),
          '5': Number(agg.star_5),
        },
        ratingDimensions: {
          cleanliness: agg.dim_cleanliness ? parseFloat(agg.dim_cleanliness) : 0,
          amenities: agg.dim_amenities ? parseFloat(agg.dim_amenities) : 0,
          accuracy: agg.dim_accuracy ? parseFloat(agg.dim_accuracy) : 0,
          value: agg.dim_value ? parseFloat(agg.dim_value) : 0,
          checkin: agg.dim_checkin ? parseFloat(agg.dim_checkin) : 0,
        },
      },
    });
  }

  // ─── Cron helpers ─────────────────────────────────────────────────────────

  async openReviewWindows(): Promise<number> {
    const bookings = await this.repo.findPendingWindowsToOpen();
    if (bookings.length === 0) return 0;

    const rows = bookings.map((b) => ({
      bookingId: b.bookingId,
      propertyId: b.propertyId,
      guestId: b.guestId,
      ownerId: b.ownerId,
      windowOpensAt: b.checkoutAt,
      expiresAt: new Date(b.checkoutAt.getTime() + 74 * HOUR_MS),
    }));

    return this.repo.bulkInsertPendingReviews(rows);
  }

  async sendReviewPrompts(): Promise<number> {
    const reviews = await this.repo.findPromptable();
    for (const review of reviews) {
      await this.repo.update(review.id, { promptSentAt: new Date() });
    }
    return reviews.length;
  }

  async expireReviews(): Promise<number> {
    const expired = await this.repo.findExpired();
    for (const review of expired) {
      await this.repo.update(review.id, { status: ReviewStatus.removed });
      await this.repo.createAuditEntry({
        review: { connect: { id: review.id } },
        actor: 'system',
        actorRole: 'system',
        action: 'removed',
        fromStatus: ReviewStatus.pending,
        toStatus: ReviewStatus.removed,
        reason: 'Review window expired without submission',
      });
    }
    return expired.length;
  }

  async sendReplyReminders(): Promise<number> {
    const reviews = await this.repo.findReplyRemindable();
    for (const review of reviews) {
      await this.repo.update(review.id, { replyReminderSent: true });
      await this.notifications.create({
        ownerId: review.ownerId,
        propertyId: review.propertyId,
        type: NotificationType.review_reply_window_reminder,
        title: 'Reply window closing soon',
        body: 'A guest review is awaiting your reply — the 96-hour reply window closes in less than 24 hours.',
        actionUrl: '/owner/reviews',
      });
    }
    return reviews.length;
  }

  // ─── Helpers ──────────────────────────────────────────────────────────────

  private async findOrThrow(id: string): Promise<Review> {
    const review = await this.repo.findById(id);
    if (!review) throw new NotFoundException('Review not found');
    return review;
  }
}

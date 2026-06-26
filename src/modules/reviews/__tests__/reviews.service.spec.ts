import {
  ConflictException,
  ForbiddenException,
  GoneException,
  HttpException,
  HttpStatus,
  NotFoundException,
} from '@nestjs/common';
import {
  Booking,
  BookingStatus,
  PaymentStatus,
  Review,
  ReviewStatus,
} from '@prisma/client';
import { Decimal } from '@prisma/client/runtime/library';
import { BookingsRepository } from '../../bookings/bookings.repository';
import { NotificationsRepository } from '../../notifications/notifications.repository';
import { PrismaService } from '../../database/prisma.service';
import { ReviewsRepository } from '../reviews.repository';
import { ReviewsService } from '../reviews.service';
import { ModerateAction } from '../dto/moderate-review.dto';

const now = new Date('2026-06-16T10:00:00.000Z');
const windowOpens = new Date(now.getTime() - 3 * 60 * 60 * 1000); // 3h ago
const windowExpires = new Date(now.getTime() + 71 * 60 * 60 * 1000); // 71h from now

function buildBooking(overrides: Partial<Booking> = {}): Booking {
  return {
    id: 'booking-1',
    bookingRef: 'PPH-B-00001',
    propertyId: 'prop-1',
    roomTypeId: 'room-1',
    ownerId: 'owner-1',
    guestId: 'guest-1',
    bookingType: 'hourly',
    checkInAt: new Date('2026-06-14T10:00:00.000Z'),
    checkOutAt: new Date('2026-06-14T13:00:00.000Z'),
    durationHours: 3,
    guestCount: 2,
    baseAmountPaise: 240000,
    gstAmountPaise: 43200,
    platformFeePaise: 0,
    totalAmountPaise: 283200,
    status: BookingStatus.completed,
    paymentStatus: PaymentStatus.success,
    paymentRef: null,
    qrCode: null,
    checkedInAt: new Date('2026-06-14T10:00:00.000Z'),
    checkedOutAt: new Date('2026-06-14T13:00:00.000Z'),
    cancelledAt: null,
    cancelledBy: null,
    cancelReason: null,
    refundAmountPaise: null,
    noShowAt: null,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  } as Booking;
}

function buildReview(overrides: Partial<Review> = {}): Review {
  return {
    id: 'review-1',
    bookingId: 'booking-1',
    propertyId: 'prop-1',
    guestId: 'guest-1',
    ownerId: 'owner-1',
    scoreOverall: 0,
    scoreCleanliness: 0,
    scoreAmenities: 0,
    scoreAccuracy: 0,
    scoreValue: 0,
    scoreCheckin: 0,
    displayScore: new Decimal('0.00'),
    reviewText: null,
    photoUrls: [],
    status: ReviewStatus.pending,
    ownerReply: null,
    ownerRepliedAt: null,
    replyWindowEnd: null,
    replyReminderSent: false,
    windowOpensAt: windowOpens,
    expiresAt: windowExpires,
    promptSentAt: null,
    submittedAt: null,
    publishedAt: null,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  } as Review;
}

const submitDto = {
  bookingId: 'booking-1',
  scoreOverall: 5,
  scoreCleanliness: 5,
  scoreAmenities: 4,
  scoreAccuracy: 5,
  scoreValue: 4,
  scoreCheckin: 5,
  reviewText: 'Lovely clean property, would stay again.',
  photoUrls: [],
};

describe(ReviewsService.name, () => {
  const repo = {
    findById: jest.fn(),
    findByBookingId: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
    createFlag: jest.fn(),
    createAuditEntry: jest.fn(),
    countOwnerFlagsThisWeek: jest.fn(),
    findOwnerFlagForReview: jest.fn(),
    getAuditLog: jest.fn(),
    listPublicForProperty: jest.fn(),
    listForAdmin: jest.fn(),
    listForOwnerProperty: jest.fn(),
    computePropertyRating: jest.fn(),
    countFlagged: jest.fn(),
    findPendingWindowsToOpen: jest.fn(),
    bulkInsertPendingReviews: jest.fn(),
    findPromptable: jest.fn(),
    findExpired: jest.fn(),
    findReplyRemindable: jest.fn(),
  };
  const bookingsRepo = {
    findById: jest.fn(),
  };
  const notifications = {
    create: jest.fn(),
  };
  const events = {
    emit: jest.fn(),
    on: jest.fn(),
  };
  const prisma = {
    property: { update: jest.fn() },
    $queryRaw: jest.fn(),
  };

  let service: ReviewsService;

  beforeEach(() => {
    jest.clearAllMocks();
    jest.useFakeTimers().setSystemTime(now);
    service = new ReviewsService(
      repo as unknown as ReviewsRepository,
      bookingsRepo as unknown as BookingsRepository,
      notifications as unknown as NotificationsRepository,
      events as never,
      prisma as unknown as PrismaService,
    );
    repo.computePropertyRating.mockResolvedValue([]);
    prisma.property.update.mockResolvedValue({});
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  // ─── submitReview ─────────────────────────────────────────────────────────

  describe('submitReview', () => {
    it('throws ForbiddenException when booking not found', async () => {
      bookingsRepo.findById.mockResolvedValue(null);
      await expect(service.submitReview('guest-1', submitDto)).rejects.toThrow(ForbiddenException);
    });

    it("throws ForbiddenException when booking belongs to a different guest", async () => {
      bookingsRepo.findById.mockResolvedValue(buildBooking({ guestId: 'other-guest' }));
      repo.findByBookingId.mockResolvedValue(buildReview());
      await expect(service.submitReview('guest-1', submitDto)).rejects.toThrow(ForbiddenException);
    });

    it('throws ForbiddenException when booking is not completed', async () => {
      bookingsRepo.findById.mockResolvedValue(buildBooking({ status: BookingStatus.checked_in }));
      repo.findByBookingId.mockResolvedValue(buildReview());
      await expect(service.submitReview('guest-1', submitDto)).rejects.toThrow(ForbiddenException);
    });

    it('throws ConflictException when review already submitted', async () => {
      bookingsRepo.findById.mockResolvedValue(buildBooking());
      repo.findByBookingId.mockResolvedValue(buildReview({ submittedAt: now }));
      await expect(service.submitReview('guest-1', submitDto)).rejects.toThrow(ConflictException);
    });

    it('throws ForbiddenException when no pending review record found', async () => {
      bookingsRepo.findById.mockResolvedValue(buildBooking());
      repo.findByBookingId.mockResolvedValue(null);
      await expect(service.submitReview('guest-1', submitDto)).rejects.toThrow(ForbiddenException);
    });

    it('throws ForbiddenException before window opens', async () => {
      bookingsRepo.findById.mockResolvedValue(buildBooking());
      repo.findByBookingId.mockResolvedValue(
        buildReview({ windowOpensAt: new Date(now.getTime() + 60 * 60 * 1000) }),
      );
      await expect(service.submitReview('guest-1', submitDto)).rejects.toThrow(ForbiddenException);
    });

    it('throws GoneException when window has expired', async () => {
      bookingsRepo.findById.mockResolvedValue(buildBooking());
      repo.findByBookingId.mockResolvedValue(
        buildReview({ expiresAt: new Date(now.getTime() - 1000) }),
      );
      await expect(service.submitReview('guest-1', submitDto)).rejects.toThrow(GoneException);
    });

    it('publishes a clean review and triggers rating recalc + owner notification', async () => {
      bookingsRepo.findById.mockResolvedValue(buildBooking());
      repo.findByBookingId.mockResolvedValue(buildReview());
      const published = buildReview({ status: ReviewStatus.published });
      repo.update.mockResolvedValue(published);
      repo.createAuditEntry.mockResolvedValue({});
      repo.computePropertyRating.mockResolvedValue([
        {
          rating_count: BigInt(1),
          rating_avg: '4.60',
          dim_cleanliness: '5.00',
          dim_amenities: '4.00',
          dim_accuracy: '5.00',
          dim_value: '4.00',
          dim_checkin: '5.00',
          star_1: BigInt(0),
          star_2: BigInt(0),
          star_3: BigInt(0),
          star_4: BigInt(0),
          star_5: BigInt(1),
        },
      ]);

      const result = await service.submitReview('guest-1', submitDto);

      expect(result.status).toBe(ReviewStatus.published);
      expect(repo.update).toHaveBeenCalledWith(
        'review-1',
        expect.objectContaining({ status: ReviewStatus.published }),
      );
      expect(notifications.create).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'review_new_on_property' }),
      );
      expect(events.emit).toHaveBeenCalledWith('review.new_on_property', expect.any(Object));
    });

    it('auto-flags a review containing a phone number (PII)', async () => {
      const piiDto = { ...submitDto, reviewText: 'Call me at +91 9876543210 for more details.' };
      bookingsRepo.findById.mockResolvedValue(buildBooking());
      repo.findByBookingId.mockResolvedValue(buildReview());
      const flagged = buildReview({ status: ReviewStatus.flagged });
      repo.update.mockResolvedValue(flagged);
      repo.createAuditEntry.mockResolvedValue({});
      repo.createFlag.mockResolvedValue({});

      const result = await service.submitReview('guest-1', piiDto);

      expect(result.status).toBe(ReviewStatus.flagged);
      expect(repo.createFlag).toHaveBeenCalledWith(
        expect.objectContaining({ flagRole: 'system' }),
      );
      expect(events.emit).toHaveBeenCalledWith('review.flagged_admin', expect.any(Object));
      expect(notifications.create).not.toHaveBeenCalled();
    });

    it('auto-flags a review containing an email address', async () => {
      const emailDto = { ...submitDto, reviewText: 'Contact guest@example.com for feedback.' };
      bookingsRepo.findById.mockResolvedValue(buildBooking());
      repo.findByBookingId.mockResolvedValue(buildReview());
      repo.update.mockResolvedValue(buildReview({ status: ReviewStatus.flagged }));
      repo.createAuditEntry.mockResolvedValue({});
      repo.createFlag.mockResolvedValue({});

      const result = await service.submitReview('guest-1', emailDto);

      expect(result.status).toBe(ReviewStatus.flagged);
    });

    it('computes correct display_score', async () => {
      bookingsRepo.findById.mockResolvedValue(buildBooking());
      repo.findByBookingId.mockResolvedValue(buildReview());
      repo.update.mockImplementation((_, data) => Promise.resolve(buildReview(data as Partial<Review>)));
      repo.createAuditEntry.mockResolvedValue({});

      await service.submitReview('guest-1', submitDto);

      const updateCall = repo.update.mock.calls[0][1];
      // 5*0.25 + 4*0.20 + 5*0.20 + 4*0.20 + 5*0.15 = 1.25 + 0.80 + 1.00 + 0.80 + 0.75 = 4.60
      expect(Number(updateCall.displayScore)).toBeCloseTo(4.6, 1);
    });
  });

  // ─── ownerReply ───────────────────────────────────────────────────────────

  describe('ownerReply', () => {
    const published = buildReview({
      status: ReviewStatus.published,
      replyWindowEnd: new Date(now.getTime() + 48 * 60 * 60 * 1000),
    });

    it('throws NotFoundException for unknown review', async () => {
      repo.findById.mockResolvedValue(null);
      await expect(service.ownerReply('review-1', 'owner-1', 'Thanks!')).rejects.toThrow(NotFoundException);
    });

    it('throws ForbiddenException when ownerId does not match', async () => {
      repo.findById.mockResolvedValue(buildReview({ status: ReviewStatus.published, ownerId: 'other-owner' }));
      await expect(service.ownerReply('review-1', 'owner-1', 'Thanks!')).rejects.toThrow(ForbiddenException);
    });

    it('throws ForbiddenException when review is not published', async () => {
      repo.findById.mockResolvedValue(buildReview({ status: ReviewStatus.flagged }));
      await expect(service.ownerReply('review-1', 'owner-1', 'Thanks!')).rejects.toThrow(ForbiddenException);
    });

    it('throws ConflictException when reply already exists', async () => {
      repo.findById.mockResolvedValue(
        buildReview({ ...published, ownerReply: 'Already replied', status: ReviewStatus.published }),
      );
      await expect(service.ownerReply('review-1', 'owner-1', 'Thanks!')).rejects.toThrow(ConflictException);
    });

    it('throws ForbiddenException when reply window has expired', async () => {
      repo.findById.mockResolvedValue(
        buildReview({
          status: ReviewStatus.published,
          replyWindowEnd: new Date(now.getTime() - 1000),
        }),
      );
      await expect(service.ownerReply('review-1', 'owner-1', 'Thanks!')).rejects.toThrow(ForbiddenException);
    });

    it('posts reply and creates audit entry', async () => {
      repo.findById.mockResolvedValue(published);
      repo.update.mockResolvedValue({ ...published, ownerReply: 'Thanks!' });
      repo.createAuditEntry.mockResolvedValue({});

      const result = await service.ownerReply('review-1', 'owner-1', 'Thanks!');

      expect(repo.update).toHaveBeenCalledWith('review-1', expect.objectContaining({ ownerReply: 'Thanks!' }));
      expect(repo.createAuditEntry).toHaveBeenCalledWith(expect.objectContaining({ action: 'replied' }));
      expect(result.ownerReply).toBe('Thanks!');
    });
  });

  // ─── ownerFlag ────────────────────────────────────────────────────────────

  describe('ownerFlag', () => {
    const published = buildReview({ status: ReviewStatus.published });

    it('throws ForbiddenException when ownerId does not match', async () => {
      repo.findById.mockResolvedValue(buildReview({ ownerId: 'other-owner', status: ReviewStatus.published }));
      await expect(service.ownerFlag('review-1', 'owner-1')).rejects.toThrow(ForbiddenException);
    });

    it('throws ConflictException when owner has already flagged', async () => {
      repo.findById.mockResolvedValue(published);
      repo.findOwnerFlagForReview.mockResolvedValue({ id: 'flag-1' });
      await expect(service.ownerFlag('review-1', 'owner-1')).rejects.toThrow(ConflictException);
    });

    it('throws 429 when weekly flag limit reached', async () => {
      repo.findById.mockResolvedValue(published);
      repo.findOwnerFlagForReview.mockResolvedValue(null);
      repo.countOwnerFlagsThisWeek.mockResolvedValue(3);
      await expect(service.ownerFlag('review-1', 'owner-1')).rejects.toThrow(
        new HttpException('Owner flag rate limit reached (3/week)', HttpStatus.TOO_MANY_REQUESTS),
      );
    });

    it('creates flag and sets review to flagged', async () => {
      repo.findById.mockResolvedValue(published);
      repo.findOwnerFlagForReview.mockResolvedValue(null);
      repo.countOwnerFlagsThisWeek.mockResolvedValue(0);
      repo.createFlag.mockResolvedValue({});
      repo.update.mockResolvedValue({ ...published, status: ReviewStatus.flagged });
      repo.createAuditEntry.mockResolvedValue({});

      await service.ownerFlag('review-1', 'owner-1', 'Inappropriate content');

      expect(repo.createFlag).toHaveBeenCalledWith(
        expect.objectContaining({ flagRole: 'owner', reason: 'Inappropriate content' }),
      );
      expect(repo.update).toHaveBeenCalledWith('review-1', { status: ReviewStatus.flagged });
    });
  });

  // ─── adminModerate ────────────────────────────────────────────────────────

  describe('adminModerate', () => {
    const flagged = buildReview({ status: ReviewStatus.flagged });

    it('throws NotFoundException for unknown review', async () => {
      repo.findById.mockResolvedValue(null);
      await expect(service.adminModerate('review-1', 'admin-1', ModerateAction.PUBLISH)).rejects.toThrow(
        NotFoundException,
      );
    });

    it('throws ForbiddenException when review is not flagged', async () => {
      repo.findById.mockResolvedValue(buildReview({ status: ReviewStatus.published }));
      await expect(service.adminModerate('review-1', 'admin-1', ModerateAction.PUBLISH)).rejects.toThrow(
        ForbiddenException,
      );
    });

    it('publishes a flagged review and recalculates rating', async () => {
      repo.findById.mockResolvedValue(flagged);
      repo.update.mockResolvedValue({ ...flagged, status: ReviewStatus.published });
      repo.createAuditEntry.mockResolvedValue({});
      repo.computePropertyRating.mockResolvedValue([]);

      const result = await service.adminModerate('review-1', 'admin-1', ModerateAction.PUBLISH);

      expect(repo.update).toHaveBeenCalledWith('review-1', expect.objectContaining({ status: ReviewStatus.published }));
      expect(result.status).toBe(ReviewStatus.published);
    });

    it('removes a flagged review with audit entry', async () => {
      repo.findById.mockResolvedValue(flagged);
      repo.update.mockResolvedValue({ ...flagged, status: ReviewStatus.removed });
      repo.createAuditEntry.mockResolvedValue({});

      const result = await service.adminModerate('review-1', 'admin-1', ModerateAction.REMOVE, 'Spam');

      expect(repo.update).toHaveBeenCalledWith('review-1', expect.objectContaining({ status: ReviewStatus.removed }));
      expect(repo.createAuditEntry).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'removed', reason: 'Spam' }),
      );
      expect(result.status).toBe(ReviewStatus.removed);
    });
  });

  // ─── adminDeleteReview ────────────────────────────────────────────────────

  describe('adminDeleteReview', () => {
    it('throws NotFoundException for unknown review', async () => {
      repo.findById.mockResolvedValue(null);
      await expect(service.adminDeleteReview('review-1', 'admin-1', 'reason')).rejects.toThrow(NotFoundException);
    });

    it('marks review removed, recalculates if was published', async () => {
      repo.findById.mockResolvedValue(buildReview({ status: ReviewStatus.published }));
      repo.update.mockResolvedValue({});
      repo.createAuditEntry.mockResolvedValue({});
      repo.computePropertyRating.mockResolvedValue([
        {
          rating_count: BigInt(4),
          rating_avg: '4.50',
          dim_cleanliness: '4.50',
          dim_amenities: '4.00',
          dim_accuracy: '5.00',
          dim_value: '4.00',
          dim_checkin: '5.00',
          star_1: BigInt(0),
          star_2: BigInt(0),
          star_3: BigInt(0),
          star_4: BigInt(2),
          star_5: BigInt(2),
        },
      ]);

      await service.adminDeleteReview('review-1', 'admin-1', 'Policy violation');

      expect(repo.update).toHaveBeenCalledWith('review-1', { status: ReviewStatus.removed });
      expect(prisma.property.update).toHaveBeenCalled();
    });

    it('does not recalculate rating when deleting a non-published review', async () => {
      repo.findById.mockResolvedValue(buildReview({ status: ReviewStatus.flagged }));
      repo.update.mockResolvedValue({});
      repo.createAuditEntry.mockResolvedValue({});

      await service.adminDeleteReview('review-1', 'admin-1', 'Policy violation');

      expect(prisma.property.update).not.toHaveBeenCalled();
    });
  });

  // ─── Cron: expireReviews ──────────────────────────────────────────────────

  describe('expireReviews', () => {
    it('marks expired pending reviews as removed', async () => {
      const expired = buildReview({ status: ReviewStatus.pending, expiresAt: new Date(now.getTime() - 1000) });
      repo.findExpired.mockResolvedValue([expired]);
      repo.update.mockResolvedValue({});
      repo.createAuditEntry.mockResolvedValue({});

      const count = await service.expireReviews();

      expect(count).toBe(1);
      expect(repo.update).toHaveBeenCalledWith('review-1', { status: ReviewStatus.removed });
    });

    it('returns 0 when no reviews have expired', async () => {
      repo.findExpired.mockResolvedValue([]);
      const count = await service.expireReviews();
      expect(count).toBe(0);
    });
  });

  // ─── Cron: openReviewWindows ──────────────────────────────────────────────

  describe('openReviewWindows', () => {
    it('returns 0 when there are no eligible completed bookings', async () => {
      repo.findPendingWindowsToOpen.mockResolvedValue([]);
      const count = await service.openReviewWindows();
      expect(count).toBe(0);
    });

    it('calls bulkInsert for eligible bookings', async () => {
      const checkout = new Date('2026-06-14T13:00:00.000Z');
      repo.findPendingWindowsToOpen.mockResolvedValue([
        { bookingId: 'booking-1', propertyId: 'prop-1', guestId: 'guest-1', ownerId: 'owner-1', checkoutAt: checkout },
      ]);
      repo.bulkInsertPendingReviews.mockResolvedValue(1);

      const count = await service.openReviewWindows();

      expect(count).toBe(1);
      expect(repo.bulkInsertPendingReviews).toHaveBeenCalledWith([
        expect.objectContaining({
          bookingId: 'booking-1',
          windowOpensAt: checkout,
        }),
      ]);
    });
  });

  // ─── Cron: sendReplyReminders ─────────────────────────────────────────────

  describe('sendReplyReminders', () => {
    it('sets replyReminderSent and creates owner notification', async () => {
      const review = buildReview({
        status: ReviewStatus.published,
        replyWindowEnd: new Date(now.getTime() + 12 * 60 * 60 * 1000),
      });
      repo.findReplyRemindable.mockResolvedValue([review]);
      repo.update.mockResolvedValue({});
      notifications.create.mockResolvedValue({});

      const count = await service.sendReplyReminders();

      expect(count).toBe(1);
      expect(repo.update).toHaveBeenCalledWith('review-1', { replyReminderSent: true });
      expect(notifications.create).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'review_reply_window_reminder' }),
      );
    });
  });

  // ─── recalculatePropertyRating ────────────────────────────────────────────

  describe('recalculatePropertyRating', () => {
    it('sets ratingAvg to null when count < 5', async () => {
      repo.computePropertyRating.mockResolvedValue([
        {
          rating_count: BigInt(3),
          rating_avg: '4.20',
          dim_cleanliness: '4.00',
          dim_amenities: '4.00',
          dim_accuracy: '4.00',
          dim_value: '4.00',
          dim_checkin: '5.00',
          star_1: BigInt(0),
          star_2: BigInt(0),
          star_3: BigInt(1),
          star_4: BigInt(1),
          star_5: BigInt(1),
        },
      ]);

      await service.recalculatePropertyRating('prop-1');

      expect(prisma.property.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ ratingAvg: null, ratingCount: 3 }),
        }),
      );
    });

    it('sets ratingAvg when count >= 5', async () => {
      repo.computePropertyRating.mockResolvedValue([
        {
          rating_count: BigInt(5),
          rating_avg: '4.60',
          dim_cleanliness: '5.00',
          dim_amenities: '4.00',
          dim_accuracy: '5.00',
          dim_value: '4.00',
          dim_checkin: '5.00',
          star_1: BigInt(0),
          star_2: BigInt(0),
          star_3: BigInt(0),
          star_4: BigInt(2),
          star_5: BigInt(3),
        },
      ]);

      await service.recalculatePropertyRating('prop-1');

      expect(prisma.property.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ ratingAvg: 4.6, ratingCount: 5 }),
        }),
      );
    });
  });
});

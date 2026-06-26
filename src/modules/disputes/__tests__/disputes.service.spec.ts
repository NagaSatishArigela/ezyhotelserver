import { BadRequestException, ConflictException, ForbiddenException, NotFoundException } from '@nestjs/common';
import {
  Booking,
  BookingStatus,
  Dispute,
  DisputeCategory,
  DisputeRequestedResolution,
  DisputeResolutionType,
  DisputeStatus,
  GlobalRole,
  NotificationType,
  PaymentStatus,
  PropertyRole,
  User,
  UserStatus,
  WalletCreditSourceType,
} from '@prisma/client';
import { DOMAIN_EVENTS } from '../../../common/events/domain-events';
import { BookingsRepository } from '../../bookings/bookings.repository';
import { PrismaService } from '../../database/prisma.service';
import { NotificationsRepository } from '../../notifications/notifications.repository';
import { RedisService } from '../../redis/redis.service';
import { UsersRepository } from '../../auth/repositories/user.repository';
import { DisputesRepository } from '../disputes.repository';
import { DisputesService } from '../disputes.service';

const now = new Date('2026-06-15T12:00:00.000Z');

function buildBooking(overrides: Partial<Booking> = {}): Booking {
  return {
    id: 'booking-1',
    bookingRef: 'PPH-B-00001',
    propertyId: 'prop-1',
    roomTypeId: 'room-1',
    ownerId: 'owner-1',
    guestId: 'guest-1',
    bookingType: 'hourly',
    checkInAt: new Date('2026-06-10T15:00:00.000Z'),
    checkOutAt: new Date('2026-06-10T18:00:00.000Z'),
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
    checkedInAt: new Date('2026-06-15T09:00:00.000Z'),
    checkedOutAt: new Date('2026-06-15T11:00:00.000Z'),
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

function buildDispute(overrides: Partial<Dispute> = {}): Dispute {
  return {
    id: 'dispute-1',
    disputeRef: 'PPH-D-00001',
    bookingId: 'booking-1',
    guestId: 'guest-1',
    propertyId: 'prop-1',
    category: DisputeCategory.cleanliness,
    description: 'Room was dirty',
    guestEvidence: null,
    requestedResolution: DisputeRequestedResolution.full_refund,
    hotelResponse: null,
    hotelEvidence: null,
    hotelResponseDeadline: null,
    status: DisputeStatus.filed,
    resolutionType: null,
    refundAmountPaise: null,
    adminNotes: null,
    resolvedBy: null,
    filedAt: now,
    resolutionDeadline: new Date('2026-06-22T12:00:00.000Z'),
    resolvedAt: null,
    ...overrides,
  } as Dispute;
}

function buildUser(overrides: Partial<User> = {}): User {
  return {
    id: 'guest-1',
    phone: '9876543210',
    email: 'guest@example.com',
    passwordHash: 'hash',
    globalRole: GlobalRole.USER,
    isPhoneVerified: true,
    isEmailVerified: true,
    status: UserStatus.active,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  } as User;
}

describe(DisputesService.name, () => {
  const repo = {
    generateDisputeRef: jest.fn(),
    findById: jest.fn(),
    findByBookingId: jest.fn(),
    create: jest.fn(),
    updateIfStatus: jest.fn(),
    findManyForAdmin: jest.fn(),
    countUnresolved: jest.fn(),
    countByGuest: jest.fn(),
    countByProperty: jest.fn(),
    findExpired: jest.fn(),
    createWalletCredit: jest.fn(),
  };
  const bookingsRepo = {
    findById: jest.fn(),
    findProperty: jest.fn(),
    updateIfStatus: jest.fn(),
    findManyByGuest: jest.fn(),
  };
  const notifications = {
    create: jest.fn(),
  };
  const users = {
    findById: jest.fn(),
    hasPropertyRole: jest.fn(),
  };
  const events = {
    emit: jest.fn(),
    on: jest.fn(),
  };

  const prisma = {
    $transaction: jest.fn(),
    dispute: { updateMany: jest.fn(), findUnique: jest.fn() },
    booking: { findUnique: jest.fn(), update: jest.fn() },
  };
  const redis = {
    acquireLock: jest.fn(),
  };

  let service: DisputesService;

  beforeEach(() => {
    jest.clearAllMocks();
    jest.useFakeTimers().setSystemTime(now);
    // Default: lock always acquired; $transaction passes through to callback
    redis.acquireLock.mockResolvedValue(jest.fn());
    prisma.$transaction.mockImplementation((fn: (tx: unknown) => unknown) => fn(prisma));
    service = new DisputesService(
      repo as unknown as DisputesRepository,
      bookingsRepo as unknown as BookingsRepository,
      notifications as unknown as NotificationsRepository,
      users as unknown as UsersRepository,
      events as never,
      prisma as unknown as PrismaService,
      redis as unknown as RedisService,
    );
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  describe('fileDispute', () => {
    const dto = {
      category: DisputeCategory.cleanliness,
      description: 'Room was dirty',
      requestedResolution: DisputeRequestedResolution.full_refund,
      evidence: ['https://example.com/photo.jpg'],
    };

    it('throws NotFoundException when the booking does not exist', async () => {
      bookingsRepo.findById.mockResolvedValue(null);
      await expect(service.fileDispute('booking-1', 'guest-1', dto)).rejects.toThrow(NotFoundException);
    });

    it("throws NotFoundException when the booking isn't the caller's", async () => {
      bookingsRepo.findById.mockResolvedValue(buildBooking({ guestId: 'someone-else' }));
      await expect(service.fileDispute('booking-1', 'guest-1', dto)).rejects.toThrow(NotFoundException);
    });

    it('throws ConflictException for a non-completed booking', async () => {
      bookingsRepo.findById.mockResolvedValue(buildBooking({ status: BookingStatus.checked_in }));
      await expect(service.fileDispute('booking-1', 'guest-1', dto)).rejects.toThrow(ConflictException);
    });

    it('throws ForbiddenException outside the 48h filing window', async () => {
      bookingsRepo.findById.mockResolvedValue(
        buildBooking({ checkedOutAt: new Date('2026-06-12T00:00:00.000Z') }),
      );
      await expect(service.fileDispute('booking-1', 'guest-1', dto)).rejects.toThrow(ForbiddenException);
    });

    it('throws ConflictException if a dispute already exists for the booking', async () => {
      bookingsRepo.findById.mockResolvedValue(buildBooking());
      repo.findByBookingId.mockResolvedValue(buildDispute());
      await expect(service.fileDispute('booking-1', 'guest-1', dto)).rejects.toThrow(ConflictException);
    });

    it('creates a dispute with a 7-day resolution deadline and emits dispute.filed', async () => {
      bookingsRepo.findById.mockResolvedValue(buildBooking());
      repo.findByBookingId.mockResolvedValue(null);
      repo.generateDisputeRef.mockResolvedValue('PPH-D-00001');
      repo.create.mockImplementation((data) => Promise.resolve(buildDispute(data as Partial<Dispute>)));

      const dispute = await service.fileDispute('booking-1', 'guest-1', dto);

      expect(repo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          disputeRef: 'PPH-D-00001',
          bookingId: 'booking-1',
          guestId: 'guest-1',
          propertyId: 'prop-1',
          status: DisputeStatus.filed,
          resolutionDeadline: new Date('2026-06-22T12:00:00.000Z'),
        }),
      );
      expect(events.emit).toHaveBeenCalledWith(
        DOMAIN_EVENTS.DISPUTE_FILED,
        expect.objectContaining({ disputeId: dispute.id, bookingId: 'booking-1', guestUserId: 'guest-1' }),
      );
    });
  });

  describe('list / unresolvedCount', () => {
    it('maps rows and passes through filters/pagination', async () => {
      repo.findManyForAdmin.mockResolvedValue({
        items: [
          {
            id: 'dispute-1',
            dispute_ref: 'PPH-D-00001',
            booking_id: 'booking-1',
            guest_id: 'guest-1',
            property_id: 'prop-1',
            category: DisputeCategory.cleanliness,
            status: DisputeStatus.filed,
            filed_at: now,
            resolution_deadline: new Date('2026-06-22T12:00:00.000Z'),
            booking_ref: 'PPH-B-00001',
            property_name: 'Sunrise Hotel',
            guest_phone: '9876543210',
          },
        ],
        total: 1,
      });

      const result = await service.list({ page: 1, limit: 50, order: 'asc' } as never);

      expect(result.total).toBe(1);
      expect(result.items[0]).toMatchObject({
        id: 'dispute-1',
        disputeRef: 'PPH-D-00001',
        bookingRef: 'PPH-B-00001',
        hoursUntilDeadline: 24 * 7,
      });
    });

    it('throws BadRequestException when dateFrom is after dateTo', async () => {
      await expect(
        service.list({ page: 1, limit: 50, order: 'asc', dateFrom: '2026-06-15', dateTo: '2026-06-01' } as never),
      ).rejects.toThrow(BadRequestException);
    });

    it('returns the unresolved count', async () => {
      repo.countUnresolved.mockResolvedValue(3);
      await expect(service.unresolvedCount()).resolves.toEqual({ count: 3 });
    });
  });

  describe('getDetail', () => {
    it('throws NotFoundException when the dispute does not exist', async () => {
      repo.findById.mockResolvedValue(null);
      await expect(service.getDetail('missing')).rejects.toThrow(NotFoundException);
    });

    it('auto-transitions filed -> under_review and assembles context', async () => {
      repo.findById.mockResolvedValue(buildDispute({ status: DisputeStatus.filed }));
      repo.updateIfStatus.mockResolvedValue(buildDispute({ status: DisputeStatus.under_review }));
      bookingsRepo.findById.mockResolvedValue(buildBooking());
      users.findById.mockResolvedValue(buildUser());
      bookingsRepo.findProperty.mockResolvedValue({ name: 'Sunrise Hotel', city: 'Mumbai' });
      repo.countByGuest.mockResolvedValue(2);
      repo.countByProperty.mockResolvedValue(1);
      bookingsRepo.findManyByGuest.mockResolvedValue([[], 5]);

      const detail = await service.getDetail('dispute-1');

      expect(repo.updateIfStatus).toHaveBeenCalledWith('dispute-1', [DisputeStatus.filed], {
        status: DisputeStatus.under_review,
      });
      expect(detail.dispute.status).toBe(DisputeStatus.under_review);
      expect(detail.booking).toMatchObject({ bookingRef: 'PPH-B-00001', totalAmountPaise: 283200 });
      expect(detail.guest).toMatchObject({ phone: '9876543210', totalBookings: 5, pastDisputeCount: 1, hasReview: false });
      expect(detail.property).toMatchObject({ name: 'Sunrise Hotel', city: 'Mumbai', pastDisputeCount: 0 });
    });

    it('does not re-transition a dispute already past filed', async () => {
      repo.findById.mockResolvedValue(buildDispute({ status: DisputeStatus.under_review }));
      bookingsRepo.findById.mockResolvedValue(buildBooking());
      users.findById.mockResolvedValue(buildUser());
      bookingsRepo.findProperty.mockResolvedValue({ name: 'Sunrise Hotel', city: 'Mumbai' });
      repo.countByGuest.mockResolvedValue(1);
      repo.countByProperty.mockResolvedValue(1);
      bookingsRepo.findManyByGuest.mockResolvedValue([[], 1]);

      await service.getDetail('dispute-1');

      expect(repo.updateIfStatus).not.toHaveBeenCalled();
    });
  });

  describe('requestResponse', () => {
    it('throws NotFoundException when the dispute does not exist', async () => {
      repo.findById.mockResolvedValue(null);
      await expect(service.requestResponse('missing')).rejects.toThrow(NotFoundException);
    });

    it('throws ConflictException if a response has already been requested', async () => {
      repo.findById.mockResolvedValue(buildDispute({ status: DisputeStatus.awaiting_hotel_response }));
      repo.updateIfStatus.mockResolvedValue(null);
      await expect(service.requestResponse('dispute-1')).rejects.toThrow(ConflictException);
    });

    it('opens the 48h response window and notifies the owner', async () => {
      repo.findById.mockResolvedValue(buildDispute({ status: DisputeStatus.filed }));
      repo.updateIfStatus.mockResolvedValue(
        buildDispute({
          status: DisputeStatus.awaiting_hotel_response,
          hotelResponseDeadline: new Date('2026-06-17T12:00:00.000Z'),
        }),
      );
      bookingsRepo.findById.mockResolvedValue(buildBooking());

      const updated = await service.requestResponse('dispute-1');

      expect(repo.updateIfStatus).toHaveBeenCalledWith(
        'dispute-1',
        [DisputeStatus.filed, DisputeStatus.under_review],
        expect.objectContaining({
          status: DisputeStatus.awaiting_hotel_response,
          hotelResponseDeadline: new Date('2026-06-17T12:00:00.000Z'),
        }),
      );
      expect(notifications.create).toHaveBeenCalledWith(
        expect.objectContaining({ ownerId: 'owner-1', type: NotificationType.dispute_response_requested }),
      );
      expect(updated.status).toBe(DisputeStatus.awaiting_hotel_response);
    });
  });

  describe('submitHotelResponse', () => {
    const dto = { response: 'We cleaned the room before check-in.', evidence: [] };

    it('throws ForbiddenException when the caller lacks OWNER/MANAGER role on the property', async () => {
      repo.findById.mockResolvedValue(
        buildDispute({
          status: DisputeStatus.awaiting_hotel_response,
          hotelResponseDeadline: new Date('2026-06-17T12:00:00.000Z'),
        }),
      );
      users.hasPropertyRole.mockResolvedValue(false);

      await expect(service.submitHotelResponse('dispute-1', 'user-1', dto)).rejects.toThrow(ForbiddenException);
      expect(users.hasPropertyRole).toHaveBeenCalledWith('user-1', 'prop-1', [
        PropertyRole.OWNER,
        PropertyRole.MANAGER,
      ]);
    });

    it('throws ConflictException when the response window has closed', async () => {
      repo.findById.mockResolvedValue(
        buildDispute({
          status: DisputeStatus.awaiting_hotel_response,
          hotelResponseDeadline: new Date('2026-06-14T12:00:00.000Z'),
        }),
      );
      users.hasPropertyRole.mockResolvedValue(true);

      await expect(service.submitHotelResponse('dispute-1', 'owner-1', dto)).rejects.toThrow(ConflictException);
    });

    it('throws ConflictException when the dispute is not awaiting a response', async () => {
      repo.findById.mockResolvedValue(buildDispute({ status: DisputeStatus.under_review }));
      users.hasPropertyRole.mockResolvedValue(true);

      await expect(service.submitHotelResponse('dispute-1', 'owner-1', dto)).rejects.toThrow(ConflictException);
    });

    it('records the response and returns to under_review', async () => {
      repo.findById.mockResolvedValue(
        buildDispute({
          status: DisputeStatus.awaiting_hotel_response,
          hotelResponseDeadline: new Date('2026-06-17T12:00:00.000Z'),
        }),
      );
      users.hasPropertyRole.mockResolvedValue(true);
      repo.updateIfStatus.mockResolvedValue(
        buildDispute({ status: DisputeStatus.under_review, hotelResponse: dto.response }),
      );

      const updated = await service.submitHotelResponse('dispute-1', 'owner-1', dto);

      expect(repo.updateIfStatus).toHaveBeenCalledWith('dispute-1', [DisputeStatus.awaiting_hotel_response], {
        hotelResponse: dto.response,
        hotelEvidence: dto.evidence,
        status: DisputeStatus.under_review,
      });
      expect(updated.status).toBe(DisputeStatus.under_review);
    });
  });

  describe('resolve', () => {
    const baseDto = { adminNotes: 'Reviewed evidence and resolved.' };

    beforeEach(() => {
      repo.findById.mockResolvedValue(buildDispute({ status: DisputeStatus.under_review }));
      bookingsRepo.findById.mockResolvedValue(buildBooking());
      // AR-02: defaults for prisma transaction mocks used in refund cases
      prisma.dispute.updateMany.mockResolvedValue({ count: 1 });
      prisma.booking.findUnique.mockResolvedValue(buildBooking());
      prisma.dispute.findUnique.mockResolvedValue(buildDispute());
    });

    it('throws ConflictException when the dispute is already resolved', async () => {
      repo.updateIfStatus.mockResolvedValue(null);
      await expect(
        service.resolve('dispute-1', 'admin-1', { ...baseDto, resolutionType: DisputeResolutionType.no_action }),
      ).rejects.toThrow(ConflictException);
    });

    it('full_refund: sets resolved_guest, refunds the full amount, and notifies the owner', async () => {
      prisma.dispute.findUnique.mockResolvedValue(
        buildDispute({ status: DisputeStatus.resolved_guest, resolutionType: DisputeResolutionType.full_refund }),
      );

      await service.resolve('dispute-1', 'admin-1', {
        ...baseDto,
        resolutionType: DisputeResolutionType.full_refund,
      });

      // AR-02: refund resolutions go through prisma.$transaction, not repo.updateIfStatus
      expect(prisma.dispute.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'dispute-1', status: { in: [DisputeStatus.filed, DisputeStatus.under_review, DisputeStatus.awaiting_hotel_response] } },
          data: expect.objectContaining({
            status: DisputeStatus.resolved_guest,
            resolutionType: DisputeResolutionType.full_refund,
            refundAmountPaise: 283200,
            resolvedBy: 'admin-1',
          }),
        }),
      );
      expect(prisma.booking.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'booking-1' },
          data: expect.objectContaining({
            refundAmountPaise: 283200,
            paymentStatus: PaymentStatus.refunded,
          }),
        }),
      );
      expect(notifications.create).toHaveBeenCalledWith(
        expect.objectContaining({ ownerId: 'owner-1', type: NotificationType.dispute_resolved }),
      );
    });

    it('partial_refund: requires refundAmountPaise and rejects amounts over the booking total', async () => {
      await expect(
        service.resolve('dispute-1', 'admin-1', {
          ...baseDto,
          resolutionType: DisputeResolutionType.partial_refund,
        }),
      ).rejects.toThrow(BadRequestException);

      await expect(
        service.resolve('dispute-1', 'admin-1', {
          ...baseDto,
          resolutionType: DisputeResolutionType.partial_refund,
          refundAmountPaise: 999999,
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('partial_refund: refunds the requested amount and notifies the owner', async () => {
      prisma.dispute.findUnique.mockResolvedValue(
        buildDispute({ status: DisputeStatus.resolved_partial, resolutionType: DisputeResolutionType.partial_refund }),
      );

      await service.resolve('dispute-1', 'admin-1', {
        ...baseDto,
        resolutionType: DisputeResolutionType.partial_refund,
        refundAmountPaise: 100000,
      });

      expect(prisma.booking.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'booking-1' },
          data: expect.objectContaining({
            refundAmountPaise: 100000,
            paymentStatus: PaymentStatus.refunded,
          }),
        }),
      );
      expect(notifications.create).toHaveBeenCalledWith(
        expect.objectContaining({ type: NotificationType.dispute_resolved }),
      );
    });

    it('no_action: resolves in the hotel’s favour with no refund or notification', async () => {
      repo.updateIfStatus.mockResolvedValue(
        buildDispute({ status: DisputeStatus.resolved_hotel, resolutionType: DisputeResolutionType.no_action }),
      );

      await service.resolve('dispute-1', 'admin-1', { ...baseDto, resolutionType: DisputeResolutionType.no_action });

      expect(bookingsRepo.updateIfStatus).not.toHaveBeenCalled();
      expect(notifications.create).not.toHaveBeenCalled();
    });

    it('wallet_credit: requires walletCreditAmountPaise and creates a ledger entry with no payout impact', async () => {
      await expect(
        service.resolve('dispute-1', 'admin-1', { ...baseDto, resolutionType: DisputeResolutionType.wallet_credit }),
      ).rejects.toThrow(BadRequestException);

      repo.updateIfStatus.mockResolvedValue(
        buildDispute({
          status: DisputeStatus.resolved_wallet_credit,
          resolutionType: DisputeResolutionType.wallet_credit,
        }),
      );

      await service.resolve('dispute-1', 'admin-1', {
        ...baseDto,
        resolutionType: DisputeResolutionType.wallet_credit,
        walletCreditAmountPaise: 50000,
      });

      expect(repo.createWalletCredit).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: 'guest-1',
          amountPaise: 50000,
          sourceType: WalletCreditSourceType.dispute,
          sourceId: 'dispute-1',
          createdBy: 'admin-1',
        }),
      );
      expect(bookingsRepo.updateIfStatus).not.toHaveBeenCalled();
      expect(notifications.create).not.toHaveBeenCalled();
    });

    it('escalated: terminal status with no refund and no owner notification', async () => {
      repo.updateIfStatus.mockResolvedValue(
        buildDispute({ status: DisputeStatus.escalated, resolutionType: DisputeResolutionType.escalated }),
      );

      await service.resolve('dispute-1', 'admin-1', { ...baseDto, resolutionType: DisputeResolutionType.escalated });

      expect(bookingsRepo.updateIfStatus).not.toHaveBeenCalled();
      expect(notifications.create).not.toHaveBeenCalled();
    });
  });

  describe('runAutoClose', () => {
    it('closes expired disputes, refunds in full, and notifies the owner', async () => {
      repo.findExpired.mockResolvedValue([buildDispute({ status: DisputeStatus.under_review })]);
      bookingsRepo.findById.mockResolvedValue(buildBooking());
      repo.updateIfStatus.mockResolvedValue(
        buildDispute({ status: DisputeStatus.closed_no_response, resolutionType: DisputeResolutionType.full_refund }),
      );

      const closed = await service.runAutoClose();

      expect(closed).toBe(1);
      expect(repo.updateIfStatus).toHaveBeenCalledWith(
        'dispute-1',
        [DisputeStatus.filed, DisputeStatus.under_review, DisputeStatus.awaiting_hotel_response],
        expect.objectContaining({
          status: DisputeStatus.closed_no_response,
          resolutionType: DisputeResolutionType.full_refund,
          refundAmountPaise: 283200,
          resolvedBy: null,
        }),
      );
      expect(bookingsRepo.updateIfStatus).toHaveBeenCalledWith('booking-1', [BookingStatus.completed], {
        refundAmountPaise: 283200,
        paymentStatus: PaymentStatus.refunded,
      });
      expect(notifications.create).toHaveBeenCalledWith(
        expect.objectContaining({ ownerId: 'owner-1', type: NotificationType.dispute_resolved }),
      );
    });

    it('skips disputes whose updateIfStatus loses the optimistic-concurrency race', async () => {
      repo.findExpired.mockResolvedValue([buildDispute({ status: DisputeStatus.under_review })]);
      bookingsRepo.findById.mockResolvedValue(buildBooking());
      repo.updateIfStatus.mockResolvedValue(null);

      const closed = await service.runAutoClose();

      expect(closed).toBe(0);
      expect(bookingsRepo.updateIfStatus).not.toHaveBeenCalled();
      expect(notifications.create).not.toHaveBeenCalled();
    });
  });
});

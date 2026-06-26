import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { Booking, BookingAdminActionType, BookingStatus, BookingType, PaymentStatus } from '@prisma/client';
import { DOMAIN_EVENTS } from '../../../../common/events/domain-events';
import { BookingsRepository } from '../../bookings.repository';
import { AdminBookingsRepository } from '../admin-bookings.repository';
import { AdminBookingsService } from '../admin-bookings.service';

const now = new Date('2026-06-13T12:00:00.000Z');

function buildBooking(overrides: Partial<Booking> = {}): Booking {
  return {
    id: 'booking-1',
    bookingRef: 'PPH-B-00001',
    propertyId: 'prop-1',
    roomTypeId: 'room-1',
    ownerId: 'owner-1',
    guestId: 'guest-1',
    bookingType: BookingType.hourly,
    checkInAt: new Date('2026-06-13T15:00:00.000Z'),
    checkOutAt: new Date('2026-06-13T18:00:00.000Z'),
    durationHours: 3,
    guestCount: 2,
    baseAmountPaise: 240000,
    gstAmountPaise: 43200,
    platformFeePaise: 0,
    totalAmountPaise: 283200,
    status: BookingStatus.confirmed,
    paymentStatus: PaymentStatus.success,
    paymentRef: 'mock_ref',
    qrCode: null,
    checkedInAt: null,
    checkedOutAt: null,
    cancelledAt: null,
    cancelledBy: null,
    cancelReason: null,
    refundAmountPaise: null,
    noShowAt: null,
    voidedAt: null,
    voidedBy: null,
    voidReason: null,
    extensionAmountPaise: null,
    isFlagged: false,
    flagType: null,
    flagNotes: null,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  } as Booking;
}

describe(AdminBookingsService.name, () => {
  const bookingsRepo = {
    findById: jest.fn(),
    update: jest.fn(),
    updateIfStatus: jest.fn(),
    hasOverlap: jest.fn(),
  };
  const repo = {
    findManyForAdmin: jest.fn(),
    getKpis: jest.fn(),
    findActive: jest.fn(),
    findDetailRow: jest.fn(),
    findGuestContact: jest.fn(),
    findPropertyArea: jest.fn(),
    findAdminActions: jest.fn(),
    createAdminAction: jest.fn(),
  };
  const events = {
    emit: jest.fn(),
    on: jest.fn(),
  };

  let service: AdminBookingsService;

  beforeEach(() => {
    jest.clearAllMocks();
    repo.findAdminActions.mockResolvedValue([]);
    repo.findPropertyArea.mockResolvedValue({ id: 'prop-1', name: 'Sunrise Hotel', city: 'Pune', area: 'Kothrud' });
    repo.findGuestContact.mockResolvedValue({ phone: '9876543210', email: 'guest@example.com' });
    service = new AdminBookingsService(
      bookingsRepo as unknown as BookingsRepository,
      repo as unknown as AdminBookingsRepository,
      events as never,
    );
  });

  describe('list', () => {
    it('throws BadRequestException when amountMin > amountMax', async () => {
      repo.findManyForAdmin.mockResolvedValue({ items: [], total: 0 });
      await expect(
        service.list({ page: 1, limit: 50, sort: 'createdAt', order: 'desc', amountMin: 500, amountMax: 100 }),
      ).rejects.toThrow(BadRequestException);
    });

    it('defaults the date range to the last 7 days and maps rows', async () => {
      repo.findManyForAdmin.mockResolvedValue({
        items: [
          {
            id: 'booking-1',
            booking_ref: 'PPH-B-00001',
            property_id: 'prop-1',
            room_type_id: 'room-1',
            owner_id: 'owner-1',
            guest_id: 'guest-1',
            booking_type: BookingType.hourly,
            check_in_at: new Date('2026-06-13T15:00:00.000Z'),
            check_out_at: new Date('2026-06-13T18:00:00.000Z'),
            duration_hours: 3,
            guest_count: 2,
            total_amount_paise: 283200,
            status: BookingStatus.confirmed,
            payment_status: PaymentStatus.success,
            refund_amount_paise: null,
            is_flagged: false,
            created_at: now,
            property_name: 'Sunrise Hotel',
            city: 'Pune',
            guest_phone: '9876543210',
          },
        ],
        total: 1,
      });

      const result = await service.list({ page: 1, limit: 50, sort: 'createdAt', order: 'desc' });

      expect(result.total).toBe(1);
      expect(result.items[0]).toMatchObject({
        id: 'booking-1',
        bookingRef: 'PPH-B-00001',
        propertyName: 'Sunrise Hotel',
        city: 'Pune',
        guestPhone: '9876543210',
      });

      const filters = repo.findManyForAdmin.mock.calls[0][0];
      expect(filters.dateTo.getTime() - filters.dateFrom.getTime()).toBe(7 * 24 * 60 * 60 * 1000);
    });
  });

  describe('kpis', () => {
    it('computes rates from the raw counts', async () => {
      repo.getKpis.mockResolvedValue({
        total_bookings: 10n,
        total_gbv_paise: 1000000n,
        cancelled_count: 2n,
        no_show_count: 1n,
      });

      const result = await service.kpis({});

      expect(result).toEqual({
        totalBookings: 10,
        totalGbvPaise: 1000000,
        cancellationRate: 20,
        avgBookingValuePaise: 100000,
        noShowRate: 10,
      });
    });

    it('returns zeroes when there are no bookings', async () => {
      repo.getKpis.mockResolvedValue({
        total_bookings: 0n,
        total_gbv_paise: 0n,
        cancelled_count: 0n,
        no_show_count: 0n,
      });

      const result = await service.kpis({});

      expect(result).toEqual({
        totalBookings: 0,
        totalGbvPaise: 0,
        cancellationRate: 0,
        avgBookingValuePaise: 0,
        noShowRate: 0,
      });
    });
  });

  describe('active', () => {
    it('computes timeRemainingSeconds and isOverdue', async () => {
      jest.useFakeTimers().setSystemTime(now);
      repo.findActive.mockResolvedValue([
        {
          id: 'booking-1',
          booking_ref: 'PPH-B-00001',
          property_id: 'prop-1',
          room_type_id: 'room-1',
          owner_id: 'owner-1',
          guest_id: 'guest-1',
          booking_type: BookingType.hourly,
          check_in_at: new Date('2026-06-13T09:00:00.000Z'),
          check_out_at: new Date('2026-06-13T11:00:00.000Z'), // 1hr overdue
          duration_hours: 2,
          guest_count: 2,
          total_amount_paise: 100000,
          status: BookingStatus.checked_in,
          payment_status: PaymentStatus.success,
          refund_amount_paise: null,
          is_flagged: false,
          created_at: now,
          property_name: 'Sunrise Hotel',
          city: 'Pune',
          guest_phone: '9876543210',
        },
      ]);

      const [item] = await service.active();

      expect(item.isOverdue).toBe(true);
      expect(item.timeRemainingSeconds).toBe(-3600);
      jest.useRealTimers();
    });
  });

  describe('getDetail', () => {
    it('throws NotFoundException when the booking does not exist', async () => {
      bookingsRepo.findById.mockResolvedValue(null);
      await expect(service.getDetail('missing')).rejects.toThrow(NotFoundException);
    });

    it('builds a sorted timeline from booking timestamps and admin actions', async () => {
      bookingsRepo.findById.mockResolvedValue(
        buildBooking({
          checkedInAt: new Date('2026-06-13T15:05:00.000Z'),
          checkedOutAt: new Date('2026-06-13T18:10:00.000Z'),
        }),
      );
      repo.findAdminActions.mockResolvedValue([
        {
          id: 'action-1',
          bookingId: 'booking-1',
          adminId: 'admin-1',
          action: BookingAdminActionType.flag,
          reasonCategory: null,
          reasonText: null,
          metadata: { flagType: 'suspicious' },
          createdAt: new Date('2026-06-13T16:00:00.000Z'),
        },
      ]);

      const detail = await service.getDetail('booking-1');

      expect(detail.property).toMatchObject({ name: 'Sunrise Hotel', city: 'Pune' });
      expect(detail.guest).toMatchObject({ phone: '9876543210', email: 'guest@example.com' });

      const labels = detail.timeline.map((entry) => entry.label);
      expect(labels).toEqual(['Created', 'Checked In', 'Flagged: suspicious', 'Completed']);
    });
  });

  describe('void', () => {
    it('throws ConflictException when the booking is no longer confirmed', async () => {
      bookingsRepo.findById.mockResolvedValue(buildBooking({ status: BookingStatus.checked_in }));
      bookingsRepo.updateIfStatus.mockResolvedValue(null);

      await expect(
        service.void('booking-1', 'admin-1', { reasonCategory: 'fraud' }),
      ).rejects.toThrow(ConflictException);
    });

    it('voids a confirmed booking, refunds 100% and emits booking.voided', async () => {
      const booking = buildBooking();
      bookingsRepo.findById.mockResolvedValue(booking);
      bookingsRepo.updateIfStatus.mockResolvedValue({
        ...booking,
        status: BookingStatus.voided,
        paymentStatus: PaymentStatus.refunded,
        refundAmountPaise: booking.totalAmountPaise,
      });

      const result = await service.void('booking-1', 'admin-1', {
        reasonCategory: 'fraud',
        reasonText: 'Stolen card',
      });

      expect(result.status).toBe(BookingStatus.voided);
      expect(bookingsRepo.updateIfStatus).toHaveBeenCalledWith('booking-1', [BookingStatus.confirmed], {
        status: BookingStatus.voided,
        voidedAt: expect.any(Date),
        voidedBy: 'admin-1',
        voidReason: 'Stolen card',
        paymentStatus: PaymentStatus.refunded,
        refundAmountPaise: booking.totalAmountPaise,
      });
      expect(repo.createAdminAction).toHaveBeenCalledWith(
        expect.objectContaining({ bookingId: 'booking-1', action: BookingAdminActionType.void }),
      );
      expect(events.emit).toHaveBeenCalledWith(
        DOMAIN_EVENTS.BOOKING_VOIDED,
        expect.objectContaining({ bookingId: 'booking-1', refundAmountPaise: booking.totalAmountPaise }),
      );
    });
  });

  describe('cancel', () => {
    it('cancels a confirmed booking with admin attribution', async () => {
      const booking = buildBooking({ checkInAt: new Date(now.getTime() + 3 * 60 * 60 * 1000) });
      bookingsRepo.findById.mockResolvedValue(booking);
      bookingsRepo.updateIfStatus.mockResolvedValue({ ...booking, status: BookingStatus.cancelled });

      jest.useFakeTimers().setSystemTime(now);
      const result = await service.cancel('booking-1', 'admin-1', { reasonCategory: 'admin_decision' });
      jest.useRealTimers();

      expect(result.status).toBe(BookingStatus.cancelled);
      expect(bookingsRepo.updateIfStatus).toHaveBeenCalledWith(
        'booking-1',
        [BookingStatus.confirmed],
        expect.objectContaining({ status: BookingStatus.cancelled, cancelledBy: 'admin:admin-1' }),
      );
    });

    it('throws ConflictException on a race with the guest', async () => {
      bookingsRepo.findById.mockResolvedValue(buildBooking());
      bookingsRepo.updateIfStatus.mockResolvedValue(null);

      await expect(
        service.cancel('booking-1', 'admin-1', { reasonCategory: 'admin_decision' }),
      ).rejects.toThrow(ConflictException);
    });
  });

  describe('refund', () => {
    it('throws ConflictException for a booking in a non-refundable state', async () => {
      bookingsRepo.findById.mockResolvedValue(buildBooking({ status: BookingStatus.pending_payment }));

      await expect(
        service.refund('booking-1', 'admin-1', { amountPaise: 1000, reasonCategory: 'goodwill' }),
      ).rejects.toThrow(ConflictException);
    });

    it('throws BadRequestException when amount exceeds the refundable balance', async () => {
      bookingsRepo.findById.mockResolvedValue(buildBooking({ refundAmountPaise: 100000 }));

      await expect(
        service.refund('booking-1', 'admin-1', { amountPaise: 200000, reasonCategory: 'goodwill' }),
      ).rejects.toThrow(BadRequestException);
    });

    it('logs refund_partial for a partial refund and emits booking.refunded', async () => {
      const booking = buildBooking();
      bookingsRepo.findById.mockResolvedValue(booking);
      bookingsRepo.updateIfStatus.mockResolvedValue({
        ...booking,
        refundAmountPaise: 50000,
        paymentStatus: PaymentStatus.refunded,
      });

      await service.refund('booking-1', 'admin-1', { amountPaise: 50000, reasonCategory: 'goodwill' });

      expect(repo.createAdminAction).toHaveBeenCalledWith(
        expect.objectContaining({ action: BookingAdminActionType.refund_partial }),
      );
      expect(events.emit).toHaveBeenCalledWith(
        DOMAIN_EVENTS.BOOKING_REFUNDED,
        expect.objectContaining({ amountPaise: 50000, isPartial: true }),
      );
    });

    it('logs refund_full when the cumulative refund equals the total amount', async () => {
      const booking = buildBooking();
      bookingsRepo.findById.mockResolvedValue(booking);
      bookingsRepo.updateIfStatus.mockResolvedValue({
        ...booking,
        refundAmountPaise: booking.totalAmountPaise,
        paymentStatus: PaymentStatus.refunded,
      });

      await service.refund('booking-1', 'admin-1', {
        amountPaise: booking.totalAmountPaise,
        reasonCategory: 'goodwill',
      });

      expect(repo.createAdminAction).toHaveBeenCalledWith(
        expect.objectContaining({ action: BookingAdminActionType.refund_full }),
      );
      expect(events.emit).toHaveBeenCalledWith(
        DOMAIN_EVENTS.BOOKING_REFUNDED,
        expect.objectContaining({ isPartial: false }),
      );
    });
  });

  describe('forceCheckout', () => {
    it('throws ConflictException if the booking is not checked in', async () => {
      bookingsRepo.findById.mockResolvedValue(buildBooking({ status: BookingStatus.confirmed }));
      bookingsRepo.updateIfStatus.mockResolvedValue(null);

      await expect(
        service.forceCheckout('booking-1', 'admin-1', { reasonText: 'Guest left' }),
      ).rejects.toThrow(ConflictException);
    });

    it('completes the booking and records overstayMinutes when past checkout', async () => {
      const booking = buildBooking({
        status: BookingStatus.checked_in,
        checkOutAt: new Date('2026-06-13T10:00:00.000Z'),
      });
      bookingsRepo.findById.mockResolvedValue(booking);
      bookingsRepo.updateIfStatus.mockResolvedValue({ ...booking, status: BookingStatus.completed });

      jest.useFakeTimers().setSystemTime(now); // 2hrs after checkOutAt
      await service.forceCheckout('booking-1', 'admin-1', { reasonText: 'Guest left' });
      jest.useRealTimers();

      expect(repo.createAdminAction).toHaveBeenCalledWith(
        expect.objectContaining({
          action: BookingAdminActionType.force_checkout,
          metadata: { overstayMinutes: 120 },
        }),
      );
    });
  });

  describe('extend', () => {
    const checkedInBooking = buildBooking({
      status: BookingStatus.checked_in,
      checkOutAt: new Date('2026-06-13T18:00:00.000Z'),
    });

    it('throws ConflictException if the booking is not checked in', async () => {
      bookingsRepo.findById.mockResolvedValue(buildBooking({ status: BookingStatus.confirmed }));

      await expect(
        service.extend('booking-1', 'admin-1', {
          newCheckOutAt: '2026-06-13T20:00:00.000Z',
          extensionAmountPaise: 50000,
        }),
      ).rejects.toThrow(ConflictException);
    });

    it('throws BadRequestException if newCheckOutAt is not after the current checkout', async () => {
      bookingsRepo.findById.mockResolvedValue(checkedInBooking);

      await expect(
        service.extend('booking-1', 'admin-1', {
          newCheckOutAt: '2026-06-13T17:00:00.000Z',
          extensionAmountPaise: 50000,
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('throws ConflictException if the extension overlaps another booking', async () => {
      bookingsRepo.findById.mockResolvedValue(checkedInBooking);
      bookingsRepo.hasOverlap.mockResolvedValue(true);

      await expect(
        service.extend('booking-1', 'admin-1', {
          newCheckOutAt: '2026-06-13T20:00:00.000Z',
          extensionAmountPaise: 50000,
        }),
      ).rejects.toThrow(ConflictException);
    });

    it('extends checkout, recomputes duration/total and emits booking.extended', async () => {
      bookingsRepo.findById.mockResolvedValue(checkedInBooking);
      bookingsRepo.hasOverlap.mockResolvedValue(false);
      bookingsRepo.updateIfStatus.mockResolvedValue({
        ...checkedInBooking,
        checkOutAt: new Date('2026-06-13T20:00:00.000Z'),
        durationHours: 5,
        extensionAmountPaise: 50000,
        totalAmountPaise: checkedInBooking.totalAmountPaise + 50000,
      });

      await service.extend('booking-1', 'admin-1', {
        newCheckOutAt: '2026-06-13T20:00:00.000Z',
        extensionAmountPaise: 50000,
      });

      expect(bookingsRepo.updateIfStatus).toHaveBeenCalledWith(
        'booking-1',
        [BookingStatus.checked_in],
        expect.objectContaining({
          checkOutAt: new Date('2026-06-13T20:00:00.000Z'),
          durationHours: 5,
          extensionAmountPaise: 50000,
          totalAmountPaise: checkedInBooking.totalAmountPaise + 50000,
        }),
      );
      expect(events.emit).toHaveBeenCalledWith(
        DOMAIN_EVENTS.BOOKING_EXTENDED,
        expect.objectContaining({ extensionAmountPaise: 50000 }),
      );
    });
  });

  describe('flag / unflag', () => {
    it('flags a booking and logs the action', async () => {
      const booking = buildBooking();
      bookingsRepo.findById.mockResolvedValue(booking);
      bookingsRepo.update.mockResolvedValue({ ...booking, isFlagged: true, flagType: 'suspicious' });

      await service.flag('booking-1', 'admin-1', { flagType: 'suspicious', flagNotes: 'Multiple bookings same card' });

      expect(bookingsRepo.update).toHaveBeenCalledWith('booking-1', {
        isFlagged: true,
        flagType: 'suspicious',
        flagNotes: 'Multiple bookings same card',
      });
      expect(events.emit).toHaveBeenCalledWith(
        DOMAIN_EVENTS.BOOKING_FLAGGED,
        expect.objectContaining({ flagType: 'suspicious' }),
      );
    });

    it('throws ConflictException when unflagging a booking that is not flagged', async () => {
      bookingsRepo.findById.mockResolvedValue(buildBooking({ isFlagged: false }));

      await expect(service.unflag('booking-1', 'admin-1')).rejects.toThrow(ConflictException);
    });

    it('unflags a flagged booking', async () => {
      const booking = buildBooking({ isFlagged: true, flagType: 'suspicious', flagNotes: 'note' });
      bookingsRepo.findById.mockResolvedValue(booking);
      bookingsRepo.update.mockResolvedValue({ ...booking, isFlagged: false, flagType: null, flagNotes: null });

      await service.unflag('booking-1', 'admin-1');

      expect(bookingsRepo.update).toHaveBeenCalledWith('booking-1', {
        isFlagged: false,
        flagType: null,
        flagNotes: null,
      });
    });
  });
});

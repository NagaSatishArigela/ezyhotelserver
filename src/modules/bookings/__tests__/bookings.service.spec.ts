import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import {
  Booking,
  BookingPolicy,
  BookingStatus,
  BookingType,
  GlobalRole,
  PaymentStatus,
  Property,
  PropertyStatus,
  RoomType,
  RoomTypeCategory,
} from '@prisma/client';
import { DOMAIN_EVENTS } from '../../../common/events/domain-events';
import { BookingsRepository, SlotUnavailableError } from '../bookings.repository';
import { BookingsService } from '../bookings.service';

const now = new Date('2026-06-11T12:00:00.000Z');

function buildProperty(overrides: Partial<Property> = {}): Property {
  return {
    id: 'prop-1',
    name: 'Sunrise Hotel',
    ownerId: 'owner-1',
    createdAt: now,
    updatedAt: now,
    status: PropertyStatus.approved,
    draftStep: null,
    draftData: null,
    submissionRef: 'PPH-2026-00001',
    submittedAt: now,
    revisionCount: 0,
    revisionNotes: null,
    propertyType: null,
    bookingPolicy: BookingPolicy.both,
    category: null,
    description: null,
    ownerFirstName: null,
    ownerMiddleName: null,
    ownerLastName: null,
    addressLine1: null,
    addressLine2: null,
    city: null,
    state: null,
    pincode: null,
    landmark: null,
    specialNote: null,
    latitude: null,
    longitude: null,
    amenities: [],
    houseRules: null,
    minBookingHours: 3,
    defaultCheckinTime: null,
    defaultCheckoutTime: null,
    seatingCapacity: null,
    deletionRequestedAt: null,
    deletionScheduledFor: null,
    deletionTrack: null,
    isActive: true,
    ...overrides,
  } as Property;
}

function buildRoomType(overrides: Partial<RoomType> = {}): RoomType {
  return {
    id: 'room-1',
    propertyId: 'prop-1',
    type: RoomTypeCategory.ac,
    count: 2,
    hourlyRatePaise: 80000,
    fulldayRatePaise: 500000,
    maxOccupancy: 4,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  } as RoomType;
}

function buildBooking(overrides: Partial<Booking> = {}): Booking {
  return {
    id: 'booking-1',
    bookingRef: 'PPH-B-00001',
    propertyId: 'prop-1',
    roomTypeId: 'room-1',
    ownerId: 'owner-1',
    guestId: 'guest-1',
    bookingType: BookingType.hourly,
    checkInAt: new Date('2026-06-11T15:00:00.000Z'),
    checkOutAt: new Date('2026-06-11T18:00:00.000Z'),
    durationHours: 3,
    guestCount: 2,
    baseAmountPaise: 240000,
    gstAmountPaise: 43200,
    platformFeePaise: 0,
    totalAmountPaise: 283200,
    status: BookingStatus.pending_payment,
    paymentStatus: PaymentStatus.pending,
    paymentRef: null,
    qrCode: null,
    checkedInAt: null,
    checkedOutAt: null,
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

describe(BookingsService.name, () => {
  const repo = {
    findProperty: jest.fn(),
    findRoomType: jest.fn(),
    findById: jest.fn(),
    generateBookingRef: jest.fn(),
    findOverlappingForAvailability: jest.fn(),
    createWithOverlapCheck: jest.fn(),
    update: jest.fn(),
    updateIfStatus: jest.fn(),
    findManyByGuest: jest.fn(),
    findManyByProperty: jest.fn(),
    findPendingPaymentTimedOut: jest.fn(),
    findCheckedInPastCheckout: jest.fn(),
    findConfirmedPastNoShowGrace: jest.fn(),
  };
  const events = {
    emit: jest.fn(),
    on: jest.fn(),
  };
  const config = {
    get: jest.fn(),
  };

  let service: BookingsService;

  beforeEach(() => {
    jest.clearAllMocks();
    config.get.mockReturnValue(undefined);
    service = new BookingsService(repo as unknown as BookingsRepository, events as never, config as never);
  });

  describe('getAvailability', () => {
    it('throws NotFoundException for unknown room type', async () => {
      repo.findRoomType.mockResolvedValue(null);
      await expect(service.getAvailability('prop-1', 'room-1', '2026-06-15')).rejects.toThrow(
        NotFoundException,
      );
    });

    it('throws NotFoundException when room type belongs to a different property', async () => {
      repo.findRoomType.mockResolvedValue(buildRoomType({ propertyId: 'other-prop' }));
      await expect(service.getAvailability('prop-1', 'room-1', '2026-06-15')).rejects.toThrow(
        NotFoundException,
      );
    });

    it('returns total rooms and booked intervals', async () => {
      repo.findRoomType.mockResolvedValue(buildRoomType());
      repo.findOverlappingForAvailability.mockResolvedValue([
        { checkInAt: new Date('2026-06-15T10:00:00.000Z'), checkOutAt: new Date('2026-06-15T13:00:00.000Z') },
      ]);

      const result = await service.getAvailability('prop-1', 'room-1', '2026-06-15');

      expect(result).toEqual({
        roomTypeId: 'room-1',
        date: '2026-06-15',
        totalRooms: 2,
        bookedIntervals: [
          { checkInAt: new Date('2026-06-15T10:00:00.000Z'), checkOutAt: new Date('2026-06-15T13:00:00.000Z') },
        ],
      });
    });
  });

  describe('createBooking', () => {
    const baseDto = {
      propertyId: 'prop-1',
      roomTypeId: 'room-1',
      bookingType: BookingType.hourly,
      checkInAt: '2026-06-15T10:00:00.000Z',
      durationHours: 3,
      guestCount: 2,
    };

    beforeEach(() => {
      repo.findProperty.mockResolvedValue(buildProperty());
      repo.findRoomType.mockResolvedValue(buildRoomType());
      repo.generateBookingRef.mockResolvedValue('PPH-B-00001');
    });

    it('throws NotFoundException if property is missing or not approved', async () => {
      repo.findProperty.mockResolvedValue(null);
      await expect(service.createBooking('guest-1', baseDto)).rejects.toThrow(NotFoundException);

      repo.findProperty.mockResolvedValue(buildProperty({ status: PropertyStatus.pending_review }));
      await expect(service.createBooking('guest-1', baseDto)).rejects.toThrow(NotFoundException);
    });

    it('throws NotFoundException if room type is missing or belongs to another property', async () => {
      repo.findRoomType.mockResolvedValue(null);
      await expect(service.createBooking('guest-1', baseDto)).rejects.toThrow(NotFoundException);

      repo.findRoomType.mockResolvedValue(buildRoomType({ propertyId: 'other-prop' }));
      await expect(service.createBooking('guest-1', baseDto)).rejects.toThrow(NotFoundException);
    });

    it('throws 400 if bookingType is not allowed by the property booking policy', async () => {
      repo.findProperty.mockResolvedValue(buildProperty({ bookingPolicy: BookingPolicy.fullday }));
      await expect(service.createBooking('guest-1', baseDto)).rejects.toThrow(BadRequestException);
    });

    it('throws 400 if the property has no booking policy configured', async () => {
      repo.findProperty.mockResolvedValue(buildProperty({ bookingPolicy: null }));
      await expect(service.createBooking('guest-1', baseDto)).rejects.toThrow(BadRequestException);
    });

    it('throws 400 if durationHours is below the property minimum', async () => {
      await expect(
        service.createBooking('guest-1', { ...baseDto, durationHours: 1 }),
      ).rejects.toThrow(BadRequestException);
    });

    it('defaults durationHours to the property minimum (or 3) when omitted', async () => {
      repo.createWithOverlapCheck.mockResolvedValue(buildBooking({ durationHours: 3 }));
      await service.createBooking('guest-1', { ...baseDto, durationHours: undefined });

      expect(repo.createWithOverlapCheck).toHaveBeenCalledWith(
        expect.objectContaining({ durationHours: 3 }),
        'room-1',
        2,
        expect.any(Date),
        expect.any(Date),
      );
    });

    it('throws 400 if guestCount exceeds maxOccupancy', async () => {
      await expect(
        service.createBooking('guest-1', { ...baseDto, guestCount: 10 }),
      ).rejects.toThrow(BadRequestException);
    });

    it('throws 400 if the relevant room rate is not configured', async () => {
      repo.findRoomType.mockResolvedValue(buildRoomType({ hourlyRatePaise: null }));
      await expect(service.createBooking('guest-1', baseDto)).rejects.toThrow(BadRequestException);
    });

    it('calculates base/GST/platform fee/total and persists pricing for an hourly booking', async () => {
      config.get.mockReturnValue(5000);
      repo.createWithOverlapCheck.mockResolvedValue(buildBooking());

      await service.createBooking('guest-1', baseDto);

      expect(repo.createWithOverlapCheck).toHaveBeenCalledWith(
        expect.objectContaining({
          baseAmountPaise: 240000, // 80000 * 3
          gstAmountPaise: 43200, // round(240000 * 0.18)
          platformFeePaise: 5000,
          totalAmountPaise: 288200,
          bookingType: BookingType.hourly,
          durationHours: 3,
        }),
        'room-1',
        2,
        new Date('2026-06-15T10:00:00.000Z'),
        new Date('2026-06-15T13:00:00.000Z'),
      );
    });

    it('uses the fullday rate and a fixed 24-hour duration for fullday bookings', async () => {
      repo.createWithOverlapCheck.mockResolvedValue(buildBooking({ bookingType: BookingType.fullday }));

      await service.createBooking('guest-1', { ...baseDto, bookingType: BookingType.fullday, durationHours: undefined });

      expect(repo.createWithOverlapCheck).toHaveBeenCalledWith(
        expect.objectContaining({
          baseAmountPaise: 500000,
          durationHours: 24,
        }),
        'room-1',
        2,
        new Date('2026-06-15T10:00:00.000Z'),
        new Date('2026-06-16T10:00:00.000Z'),
      );
    });

    it('returns 409 Conflict when the slot is already fully booked', async () => {
      repo.createWithOverlapCheck.mockRejectedValue(new SlotUnavailableError());
      await expect(service.createBooking('guest-1', baseDto)).rejects.toThrow(ConflictException);
    });

    it('emits booking.created on success', async () => {
      const booking = buildBooking();
      repo.createWithOverlapCheck.mockResolvedValue(booking);

      await service.createBooking('guest-1', baseDto);

      expect(events.emit).toHaveBeenCalledWith(DOMAIN_EVENTS.BOOKING_CREATED, {
        bookingId: booking.id,
        bookingRef: booking.bookingRef,
        hotelId: booking.propertyId,
        ownerId: booking.ownerId,
        roomId: booking.roomTypeId,
        guestUserId: booking.guestId,
        bookingType: booking.bookingType,
        checkIn: booking.checkInAt.toISOString(),
        checkOut: booking.checkOutAt.toISOString(),
        amountPaise: booking.totalAmountPaise,
      });
    });
  });

  describe('confirmPayment', () => {
    it('throws NotFoundException for a booking the guest does not own', async () => {
      repo.findById.mockResolvedValue(buildBooking({ guestId: 'someone-else' }));
      await expect(service.confirmPayment('booking-1', 'guest-1', { success: true })).rejects.toThrow(
        NotFoundException,
      );
    });

    it('throws ConflictException if the booking is not awaiting payment', async () => {
      repo.findById.mockResolvedValue(buildBooking({ status: BookingStatus.confirmed }));
      await expect(service.confirmPayment('booking-1', 'guest-1', { success: true })).rejects.toThrow(
        ConflictException,
      );
    });

    it('records a failed payment without confirming the booking and emits payment.failed', async () => {
      repo.findById.mockResolvedValue(buildBooking());
      repo.updateIfStatus.mockResolvedValue(
        buildBooking({ paymentStatus: PaymentStatus.failed, paymentRef: 'mock_fail' }),
      );

      const result = await service.confirmPayment('booking-1', 'guest-1', {
        success: false,
        paymentRef: 'mock_fail',
      });

      expect(repo.updateIfStatus).toHaveBeenCalledWith('booking-1', [BookingStatus.pending_payment], {
        paymentStatus: PaymentStatus.failed,
        paymentRef: 'mock_fail',
      });
      expect(events.emit).toHaveBeenCalledWith(DOMAIN_EVENTS.PAYMENT_FAILED, {
        bookingId: 'booking-1',
        paymentId: 'mock_fail',
        reason: 'Payment gateway reported failure',
      });
      expect(result.status).toBe(BookingStatus.pending_payment);
    });

    it('confirms the booking, generates a QR code and emits payment.captured + booking.confirmed', async () => {
      const booking = buildBooking();
      repo.findById.mockResolvedValue(booking);
      const confirmed = buildBooking({
        status: BookingStatus.confirmed,
        paymentStatus: PaymentStatus.success,
        paymentRef: 'pay_123',
        qrCode: 'abc123',
      });
      repo.updateIfStatus.mockResolvedValue(confirmed);

      const result = await service.confirmPayment('booking-1', 'guest-1', { success: true, paymentRef: 'pay_123' });

      expect(repo.updateIfStatus).toHaveBeenCalledWith('booking-1', [BookingStatus.pending_payment], {
        paymentStatus: PaymentStatus.success,
        paymentRef: 'pay_123',
        status: BookingStatus.confirmed,
        qrCode: expect.any(String),
      });
      expect(events.emit).toHaveBeenCalledWith(
        DOMAIN_EVENTS.PAYMENT_CAPTURED,
        expect.objectContaining({ bookingId: 'booking-1', amountPaise: confirmed.totalAmountPaise }),
      );
      expect(events.emit).toHaveBeenCalledWith(
        DOMAIN_EVENTS.BOOKING_CONFIRMED,
        expect.objectContaining({ bookingId: 'booking-1', bookingRef: confirmed.bookingRef }),
      );
      expect(result.status).toBe(BookingStatus.confirmed);
    });

    it('generates a default mock paymentRef when none is supplied', async () => {
      repo.findById.mockResolvedValue(buildBooking());
      repo.updateIfStatus.mockResolvedValue(buildBooking({ status: BookingStatus.confirmed }));

      await service.confirmPayment('booking-1', 'guest-1', { success: true });

      expect(repo.updateIfStatus).toHaveBeenCalledWith(
        'booking-1',
        [BookingStatus.pending_payment],
        expect.objectContaining({ paymentRef: 'mock_PPH-B-00001' }),
      );
    });

    it('throws ConflictException if the booking moved out of pending_payment between read and update (race)', async () => {
      repo.findById.mockResolvedValue(buildBooking());
      repo.updateIfStatus.mockResolvedValue(null);

      await expect(service.confirmPayment('booking-1', 'guest-1', { success: true })).rejects.toThrow(
        ConflictException,
      );
    });
  });

  describe('getBooking', () => {
    it('throws NotFoundException if the booking does not exist', async () => {
      repo.findById.mockResolvedValue(null);
      await expect(
        service.getBooking('booking-1', { id: 'guest-1', globalRole: GlobalRole.USER }),
      ).rejects.toThrow(NotFoundException);
    });

    it('throws NotFoundException for users who are neither the guest, the owner, nor an admin', async () => {
      repo.findById.mockResolvedValue(buildBooking());
      await expect(
        service.getBooking('booking-1', { id: 'stranger', globalRole: GlobalRole.USER }),
      ).rejects.toThrow(NotFoundException);
    });

    it('allows the guest, the owner and admins to view the booking', async () => {
      const booking = buildBooking();
      repo.findById.mockResolvedValue(booking);

      await expect(service.getBooking('booking-1', { id: 'guest-1', globalRole: GlobalRole.USER })).resolves.toEqual(
        booking,
      );
      await expect(service.getBooking('booking-1', { id: 'owner-1', globalRole: GlobalRole.USER })).resolves.toEqual(
        booking,
      );
      await expect(
        service.getBooking('booking-1', { id: 'admin-1', globalRole: GlobalRole.SUPER_ADMIN }),
      ).resolves.toEqual(booking);
    });
  });

  describe('checkIn', () => {
    const confirmedBooking = buildBooking({
      status: BookingStatus.confirmed,
      qrCode: 'valid-token',
      checkInAt: new Date('2026-06-11T15:00:00.000Z'),
    });

    it('throws NotFoundException if the booking does not exist', async () => {
      repo.findById.mockResolvedValue(null);
      await expect(service.checkIn('booking-1', { qrCode: 'x' }, 'guest-1')).rejects.toThrow(NotFoundException);
    });

    it('throws NotFoundException if the caller is not the booking guest', async () => {
      repo.findById.mockResolvedValue(confirmedBooking);
      await expect(service.checkIn('booking-1', { qrCode: 'valid-token' }, 'other-user')).rejects.toThrow(NotFoundException);
    });

    it('throws ConflictException if the booking is not confirmed', async () => {
      repo.findById.mockResolvedValue(buildBooking({ status: BookingStatus.pending_payment }));
      await expect(service.checkIn('booking-1', { qrCode: 'x' }, 'guest-1')).rejects.toThrow(ConflictException);
    });

    it('throws ConflictException if the QR code was already consumed', async () => {
      repo.findById.mockResolvedValue(buildBooking({ status: BookingStatus.confirmed, qrCode: null }));
      await expect(service.checkIn('booking-1', { qrCode: 'x' }, 'guest-1')).rejects.toThrow(ConflictException);
    });

    it('throws ConflictException if the QR code does not match', async () => {
      repo.findById.mockResolvedValue(confirmedBooking);
      await expect(service.checkIn('booking-1', { qrCode: 'wrong' }, 'guest-1')).rejects.toThrow(ConflictException);
    });

    it('throws ConflictException if check-in is attempted before the early window', async () => {
      jest.useFakeTimers().setSystemTime(new Date('2026-06-11T14:30:00.000Z')); // 30 min early (window is 15)
      repo.findById.mockResolvedValue(confirmedBooking);
      await expect(service.checkIn('booking-1', { qrCode: 'valid-token' }, 'guest-1')).rejects.toThrow(ConflictException);
      jest.useRealTimers();
    });

    it('throws ConflictException if the no-show grace period has elapsed', async () => {
      jest.useFakeTimers().setSystemTime(new Date('2026-06-11T15:31:00.000Z')); // 31 min late (grace is 30)
      repo.findById.mockResolvedValue(confirmedBooking);
      await expect(service.checkIn('booking-1', { qrCode: 'valid-token' }, 'guest-1')).rejects.toThrow(ConflictException);
      jest.useRealTimers();
    });

    it('checks the guest in within the valid window and consumes the QR code', async () => {
      const checkInTime = new Date('2026-06-11T14:50:00.000Z'); // 10 min early, within 15-min window
      jest.useFakeTimers().setSystemTime(checkInTime);
      repo.findById.mockResolvedValue(confirmedBooking);
      const updated = buildBooking({ status: BookingStatus.checked_in, checkedInAt: checkInTime, qrCode: null });
      repo.updateIfStatus.mockResolvedValue(updated);

      const result = await service.checkIn('booking-1', { qrCode: 'valid-token' }, 'guest-1');

      expect(repo.updateIfStatus).toHaveBeenCalledWith('booking-1', [BookingStatus.confirmed], {
        status: BookingStatus.checked_in,
        checkedInAt: checkInTime,
        qrCode: null,
      });
      expect(events.emit).toHaveBeenCalledWith(
        DOMAIN_EVENTS.BOOKING_CHECKED_IN,
        expect.objectContaining({ bookingId: 'booking-1', at: checkInTime.toISOString() }),
      );
      expect(result.status).toBe(BookingStatus.checked_in);
      jest.useRealTimers();
    });

    it('throws ConflictException if the booking was cancelled by the auto-checkout/no-show job between read and update (race)', async () => {
      const checkInTime = new Date('2026-06-11T14:50:00.000Z');
      jest.useFakeTimers().setSystemTime(checkInTime);
      repo.findById.mockResolvedValue(confirmedBooking);
      repo.updateIfStatus.mockResolvedValue(null);

      await expect(service.checkIn('booking-1', { qrCode: 'valid-token' }, 'guest-1')).rejects.toThrow(ConflictException);
      jest.useRealTimers();
    });
  });

  describe('checkOut', () => {
    it('throws NotFoundException if the booking does not exist', async () => {
      repo.findById.mockResolvedValue(null);
      await expect(service.checkOut('booking-1', 'guest-1')).rejects.toThrow(NotFoundException);
    });

    it('throws NotFoundException if the caller is not the booking guest', async () => {
      repo.findById.mockResolvedValue(buildBooking({ status: BookingStatus.checked_in }));
      await expect(service.checkOut('booking-1', 'other-user')).rejects.toThrow(NotFoundException);
    });

    it('throws ConflictException if the booking was never checked in', async () => {
      repo.findById.mockResolvedValue(buildBooking({ status: BookingStatus.confirmed }));
      await expect(service.checkOut('booking-1', 'guest-1')).rejects.toThrow(ConflictException);
    });

    it('marks a checked-in booking completed and emits booking.checked_out', async () => {
      repo.findById.mockResolvedValue(buildBooking({ status: BookingStatus.checked_in }));
      repo.updateIfStatus.mockResolvedValue(buildBooking({ status: BookingStatus.completed }));

      const result = await service.checkOut('booking-1', 'guest-1');

      expect(repo.updateIfStatus).toHaveBeenCalledWith('booking-1', [BookingStatus.checked_in], {
        status: BookingStatus.completed,
        checkedOutAt: expect.any(Date),
      });
      expect(events.emit).toHaveBeenCalledWith(
        DOMAIN_EVENTS.BOOKING_CHECKED_OUT,
        expect.objectContaining({ bookingId: 'booking-1' }),
      );
      expect(result.status).toBe(BookingStatus.completed);
    });

    it('throws ConflictException if the auto-checkout job already completed this booking (race)', async () => {
      repo.findById.mockResolvedValue(buildBooking({ status: BookingStatus.checked_in }));
      repo.updateIfStatus.mockResolvedValue(null);

      await expect(service.checkOut('booking-1', 'guest-1')).rejects.toThrow(ConflictException);
    });
  });

  describe('cancel', () => {
    it('throws NotFoundException for a booking the guest does not own', async () => {
      repo.findById.mockResolvedValue(buildBooking({ guestId: 'someone-else', status: BookingStatus.confirmed }));
      await expect(service.cancel('booking-1', 'guest-1', {})).rejects.toThrow(NotFoundException);
    });

    it('throws ConflictException if the booking is not confirmed', async () => {
      repo.findById.mockResolvedValue(buildBooking({ status: BookingStatus.checked_in }));
      await expect(service.cancel('booking-1', 'guest-1', {})).rejects.toThrow(ConflictException);
    });

    it('refunds 100% for hourly cancellations >= 2 hours before check-in', async () => {
      jest.useFakeTimers().setSystemTime(new Date('2026-06-11T13:00:00.000Z')); // checkIn at 15:00 -> 2hrs out
      const booking = buildBooking({
        status: BookingStatus.confirmed,
        bookingType: BookingType.hourly,
        checkInAt: new Date('2026-06-11T15:00:00.000Z'),
        totalAmountPaise: 283200,
      });
      repo.findById.mockResolvedValue(booking);
      repo.updateIfStatus.mockResolvedValue(buildBooking({ status: BookingStatus.cancelled, refundAmountPaise: 283200 }));

      await service.cancel('booking-1', 'guest-1', { reason: 'change of plans' });

      expect(repo.updateIfStatus).toHaveBeenCalledWith('booking-1', [BookingStatus.confirmed], {
        status: BookingStatus.cancelled,
        cancelledAt: expect.any(Date),
        cancelledBy: 'guest',
        cancelReason: 'change of plans',
        refundAmountPaise: 283200,
      });
      expect(events.emit).toHaveBeenCalledWith(
        DOMAIN_EVENTS.BOOKING_CANCELLED,
        expect.objectContaining({ refundAmountPaise: 283200, reason: 'change of plans' }),
      );
      jest.useRealTimers();
    });

    it('refunds 0% for hourly cancellations < 2 hours before check-in', async () => {
      jest.useFakeTimers().setSystemTime(new Date('2026-06-11T14:00:00.000Z')); // checkIn at 15:00 -> 1hr out
      const booking = buildBooking({
        status: BookingStatus.confirmed,
        bookingType: BookingType.hourly,
        checkInAt: new Date('2026-06-11T15:00:00.000Z'),
        totalAmountPaise: 283200,
      });
      repo.findById.mockResolvedValue(booking);
      repo.updateIfStatus.mockResolvedValue(buildBooking({ status: BookingStatus.cancelled, refundAmountPaise: 0 }));

      await service.cancel('booking-1', 'guest-1', {});

      expect(repo.updateIfStatus).toHaveBeenCalledWith(
        'booking-1',
        [BookingStatus.confirmed],
        expect.objectContaining({ refundAmountPaise: 0 }),
      );
      jest.useRealTimers();
    });

    it('refunds 100% for fullday cancellations >= 24 hours before check-in', async () => {
      jest.useFakeTimers().setSystemTime(new Date('2026-06-10T15:00:00.000Z')); // checkIn at +1 day -> 24hrs out
      const booking = buildBooking({
        status: BookingStatus.confirmed,
        bookingType: BookingType.fullday,
        checkInAt: new Date('2026-06-11T15:00:00.000Z'),
        totalAmountPaise: 590000,
      });
      repo.findById.mockResolvedValue(booking);
      repo.updateIfStatus.mockResolvedValue(buildBooking({ status: BookingStatus.cancelled, refundAmountPaise: 590000 }));

      await service.cancel('booking-1', 'guest-1', {});

      expect(repo.updateIfStatus).toHaveBeenCalledWith(
        'booking-1',
        [BookingStatus.confirmed],
        expect.objectContaining({ refundAmountPaise: 590000 }),
      );
      jest.useRealTimers();
    });

    it('refunds 50% for fullday cancellations < 24 hours before check-in', async () => {
      jest.useFakeTimers().setSystemTime(new Date('2026-06-11T00:00:00.000Z')); // checkIn at 15:00 -> 15hrs out
      const booking = buildBooking({
        status: BookingStatus.confirmed,
        bookingType: BookingType.fullday,
        checkInAt: new Date('2026-06-11T15:00:00.000Z'),
        totalAmountPaise: 590000,
      });
      repo.findById.mockResolvedValue(booking);
      repo.updateIfStatus.mockResolvedValue(buildBooking({ status: BookingStatus.cancelled, refundAmountPaise: 295000 }));

      await service.cancel('booking-1', 'guest-1', {});

      expect(repo.updateIfStatus).toHaveBeenCalledWith(
        'booking-1',
        [BookingStatus.confirmed],
        expect.objectContaining({ refundAmountPaise: 295000 }),
      );
      jest.useRealTimers();
    });

    it('throws ConflictException if the booking was already checked in by the time cancel is processed (race)', async () => {
      jest.useFakeTimers().setSystemTime(new Date('2026-06-11T13:00:00.000Z'));
      const booking = buildBooking({
        status: BookingStatus.confirmed,
        bookingType: BookingType.hourly,
        checkInAt: new Date('2026-06-11T15:00:00.000Z'),
      });
      repo.findById.mockResolvedValue(booking);
      repo.updateIfStatus.mockResolvedValue(null);

      await expect(service.cancel('booking-1', 'guest-1', {})).rejects.toThrow(ConflictException);
      jest.useRealTimers();
    });
  });

  describe('scheduled lifecycle jobs', () => {
    it('runAutoCheckout completes checked_in bookings past checkOutAt and emits booking.checked_out', async () => {
      const due = buildBooking({ status: BookingStatus.checked_in, checkOutAt: new Date('2026-06-11T11:00:00.000Z') });
      repo.findCheckedInPastCheckout.mockResolvedValue([due]);
      repo.updateIfStatus.mockResolvedValue(buildBooking({ status: BookingStatus.completed }));

      const count = await service.runAutoCheckout(now);

      expect(repo.updateIfStatus).toHaveBeenCalledWith(due.id, [BookingStatus.checked_in], {
        status: BookingStatus.completed,
        checkedOutAt: due.checkOutAt,
      });
      expect(events.emit).toHaveBeenCalledWith(DOMAIN_EVENTS.BOOKING_CHECKED_OUT, expect.objectContaining({ bookingId: due.id }));
      expect(count).toBe(1);
    });

    it('runAutoCheckout skips a booking the guest already checked out manually (race) and does not emit', async () => {
      const due = buildBooking({ status: BookingStatus.checked_in, checkOutAt: new Date('2026-06-11T11:00:00.000Z') });
      repo.findCheckedInPastCheckout.mockResolvedValue([due]);
      repo.updateIfStatus.mockResolvedValue(null);

      const count = await service.runAutoCheckout(now);

      expect(events.emit).not.toHaveBeenCalled();
      expect(count).toBe(0);
    });

    it('runNoShowDetection marks confirmed bookings past the grace period as no_show', async () => {
      const due = buildBooking({ status: BookingStatus.confirmed, checkInAt: new Date('2026-06-11T11:00:00.000Z') });
      repo.findConfirmedPastNoShowGrace.mockResolvedValue([due]);
      repo.updateIfStatus.mockResolvedValue(buildBooking({ status: BookingStatus.no_show }));

      const count = await service.runNoShowDetection(now);

      expect(repo.findConfirmedPastNoShowGrace).toHaveBeenCalledWith(new Date(now.getTime() - 30 * 60 * 1000));
      expect(repo.updateIfStatus).toHaveBeenCalledWith(due.id, [BookingStatus.confirmed], {
        status: BookingStatus.no_show,
        noShowAt: now,
      });
      expect(events.emit).toHaveBeenCalledWith(DOMAIN_EVENTS.BOOKING_NO_SHOW, expect.objectContaining({ bookingId: due.id }));
      expect(count).toBe(1);
    });

    it('runNoShowDetection skips a booking the guest just checked into (race) and does not emit', async () => {
      const due = buildBooking({ status: BookingStatus.confirmed, checkInAt: new Date('2026-06-11T11:00:00.000Z') });
      repo.findConfirmedPastNoShowGrace.mockResolvedValue([due]);
      repo.updateIfStatus.mockResolvedValue(null);

      const count = await service.runNoShowDetection(now);

      expect(events.emit).not.toHaveBeenCalled();
      expect(count).toBe(0);
    });

    it('runPaymentTimeouts cancels stale pending_payment bookings with payment_timeout reason', async () => {
      const due = buildBooking({ status: BookingStatus.pending_payment });
      repo.findPendingPaymentTimedOut.mockResolvedValue([due]);
      repo.updateIfStatus.mockResolvedValue(buildBooking({ status: BookingStatus.cancelled, cancelReason: 'payment_timeout' }));

      const count = await service.runPaymentTimeouts(now);

      expect(repo.findPendingPaymentTimedOut).toHaveBeenCalledWith(new Date(now.getTime() - 30 * 60 * 1000));
      expect(repo.updateIfStatus).toHaveBeenCalledWith(due.id, [BookingStatus.pending_payment], {
        status: BookingStatus.cancelled,
        cancelledAt: now,
        cancelledBy: 'system',
        cancelReason: 'payment_timeout',
        refundAmountPaise: 0,
      });
      expect(events.emit).toHaveBeenCalledWith(
        DOMAIN_EVENTS.BOOKING_CANCELLED,
        expect.objectContaining({ bookingId: due.id, reason: 'payment_timeout', refundAmountPaise: 0 }),
      );
      expect(count).toBe(1);
    });

    it('runPaymentTimeouts skips a booking the guest just paid for (race) and does not emit', async () => {
      const due = buildBooking({ status: BookingStatus.pending_payment });
      repo.findPendingPaymentTimedOut.mockResolvedValue([due]);
      repo.updateIfStatus.mockResolvedValue(null);

      const count = await service.runPaymentTimeouts(now);

      expect(events.emit).not.toHaveBeenCalled();
      expect(count).toBe(0);
    });
  });

  describe('concurrent booking — slot race condition (E18)', () => {
    const baseDto = {
      propertyId: 'prop-1',
      roomTypeId: 'room-1',
      bookingType: BookingType.hourly,
      checkInAt: '2026-06-11T15:00:00.000Z',
      durationHours: 3,
      guestCount: 1,
    };

    it('converts SlotUnavailableError into ConflictException for the losing request', async () => {
      repo.findProperty.mockResolvedValue(buildProperty());
      repo.findRoomType.mockResolvedValue(buildRoomType());
      repo.generateBookingRef.mockResolvedValue('PPH-B-TEST');
      // Simulate the database serializable transaction rejecting the second writer
      repo.createWithOverlapCheck.mockRejectedValue(new SlotUnavailableError('Room fully booked for this slot'));

      await expect(service.createBooking('guest-2', baseDto)).rejects.toThrow(ConflictException);
    });

    it('allows the winning request to succeed even when the other guest races', async () => {
      const booking = buildBooking({ status: BookingStatus.pending_payment });
      repo.findProperty.mockResolvedValue(buildProperty());
      repo.findRoomType.mockResolvedValue(buildRoomType());
      repo.generateBookingRef.mockResolvedValue('PPH-B-TEST');
      // First write succeeds
      repo.createWithOverlapCheck.mockResolvedValueOnce(booking);

      const result = await service.createBooking('guest-1', baseDto);
      expect(result.status).toBe(BookingStatus.pending_payment);
    });

    it('does NOT emit booking.created on a SlotUnavailableError', async () => {
      repo.findProperty.mockResolvedValue(buildProperty());
      repo.findRoomType.mockResolvedValue(buildRoomType());
      repo.generateBookingRef.mockResolvedValue('PPH-B-TEST');
      repo.createWithOverlapCheck.mockRejectedValue(new SlotUnavailableError());

      await expect(service.createBooking('guest-2', baseDto)).rejects.toThrow();
      expect(events.emit).not.toHaveBeenCalledWith(DOMAIN_EVENTS.BOOKING_CREATED, expect.anything());
    });
  });
});

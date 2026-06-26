import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Booking, BookingPolicy, BookingStatus, BookingType, GlobalRole, PaymentStatus, PropertyStatus } from '@prisma/client';
import { randomBytes } from 'crypto';
import { DOMAIN_EVENTS } from '../../common/events/domain-events';
import { TypedEventEmitter } from '../../common/events/typed-event-emitter.service';
import { BookingsRepository, SlotUnavailableError } from './bookings.repository';
import { CancelBookingDto } from './dto/cancel-booking.dto';
import { CheckInDto } from './dto/check-in.dto';
import { CreateBookingDto } from './dto/create-booking.dto';
import { PaymentConfirmDto } from './dto/payment-confirm.dto';

const GST_RATE = 0.18;
const NO_SHOW_GRACE_MINUTES = 30;
const CHECK_IN_EARLY_WINDOW_MINUTES = 15;
const PAYMENT_TIMEOUT_MINUTES = 30;
const DEFAULT_MIN_BOOKING_HOURS = 3;
const FULLDAY_DURATION_HOURS = 24;

// Shared with AdminBookingsService (admin-initiated cancellation, M5 spec §3.5).
export function calculateBookingRefund(booking: Booking): number {
  const hoursUntilCheckIn = (booking.checkInAt.getTime() - Date.now()) / (60 * 60 * 1000);

  if (booking.bookingType === BookingType.hourly) {
    return hoursUntilCheckIn >= 2 ? booking.totalAmountPaise : 0;
  }

  return hoursUntilCheckIn >= 24 ? booking.totalAmountPaise : Math.floor(booking.totalAmountPaise / 2);
}

@Injectable()
export class BookingsService {
  constructor(
    private readonly repo: BookingsRepository,
    private readonly events: TypedEventEmitter,
    private readonly config: ConfigService,
  ) {}

  async getAvailability(propertyId: string, roomTypeId: string, date: string) {
    const roomType = await this.repo.findRoomType(roomTypeId);
    if (!roomType || roomType.propertyId !== propertyId) {
      throw new NotFoundException('Room type not found for this property');
    }

    const dayStart = new Date(`${date}T00:00:00.000Z`);
    const dayEnd = new Date(`${date}T23:59:59.999Z`);
    if (Number.isNaN(dayStart.getTime())) {
      throw new BadRequestException('Invalid date');
    }

    const bookings = await this.repo.findOverlappingForAvailability(roomTypeId, dayStart, dayEnd);

    return {
      roomTypeId,
      date,
      totalRooms: roomType.count,
      bookedIntervals: bookings.map((b) => ({ checkInAt: b.checkInAt, checkOutAt: b.checkOutAt })),
    };
  }

  async createBooking(guestId: string, dto: CreateBookingDto): Promise<Booking> {
    const property = await this.repo.findProperty(dto.propertyId);
    if (!property || property.status !== PropertyStatus.approved) {
      throw new NotFoundException('Property not found');
    }

    const roomType = await this.repo.findRoomType(dto.roomTypeId);
    if (!roomType || roomType.propertyId !== dto.propertyId) {
      throw new NotFoundException('Room type not found for this property');
    }

    this.assertBookingTypeAllowed(dto.bookingType, property.bookingPolicy);

    const checkInAt = new Date(dto.checkInAt);
    if (Number.isNaN(checkInAt.getTime())) {
      throw new BadRequestException('Invalid checkInAt');
    }

    let durationHours: number;
    let checkOutAt: Date;
    if (dto.bookingType === BookingType.hourly) {
      const minHours = property.minBookingHours ?? DEFAULT_MIN_BOOKING_HOURS;
      durationHours = dto.durationHours ?? minHours;
      if (durationHours < minHours) {
        throw new BadRequestException(`Minimum booking duration is ${minHours} hours.`);
      }
      checkOutAt = new Date(checkInAt.getTime() + durationHours * 60 * 60 * 1000);
    } else {
      durationHours = FULLDAY_DURATION_HOURS;
      checkOutAt = new Date(checkInAt.getTime() + FULLDAY_DURATION_HOURS * 60 * 60 * 1000);
    }

    if (roomType.maxOccupancy != null && dto.guestCount > roomType.maxOccupancy) {
      throw new BadRequestException(`Maximum occupancy for this room is ${roomType.maxOccupancy} guests.`);
    }

    const ratePaise = dto.bookingType === BookingType.hourly ? roomType.hourlyRatePaise : roomType.fulldayRatePaise;
    if (ratePaise == null) {
      throw new BadRequestException(
        'This room type does not have pricing configured for the requested booking type.',
      );
    }

    const baseAmountPaise = dto.bookingType === BookingType.hourly ? ratePaise * durationHours : ratePaise;
    const gstAmountPaise = Math.round(baseAmountPaise * GST_RATE);
    const platformFeePaise = Number(this.config.get('BOOKING_PLATFORM_FEE_PAISE') ?? 0);
    const totalAmountPaise = baseAmountPaise + gstAmountPaise + platformFeePaise;

    const bookingRef = await this.repo.generateBookingRef();

    let booking: Booking;
    try {
      booking = await this.repo.createWithOverlapCheck(
        {
          bookingRef,
          propertyId: property.id,
          roomTypeId: roomType.id,
          ownerId: property.ownerId,
          guestId,
          bookingType: dto.bookingType,
          checkInAt,
          checkOutAt,
          durationHours,
          guestCount: dto.guestCount,
          baseAmountPaise,
          gstAmountPaise,
          platformFeePaise,
          totalAmountPaise,
        },
        roomType.id,
        roomType.count,
        checkInAt,
        checkOutAt,
      );
    } catch (err) {
      if (err instanceof SlotUnavailableError) {
        throw new ConflictException('This slot was just booked. Please choose another time.');
      }
      throw err;
    }

    this.events.emit(DOMAIN_EVENTS.BOOKING_CREATED, {
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

    return booking;
  }

  async confirmPayment(bookingId: string, guestId: string, dto: PaymentConfirmDto): Promise<Booking> {
    const booking = await this.getOwnedByGuest(bookingId, guestId);
    if (booking.status !== BookingStatus.pending_payment) {
      throw new ConflictException('This booking is not awaiting payment.');
    }

    if (!dto.success) {
      const updated = await this.repo.updateIfStatus(booking.id, [BookingStatus.pending_payment], {
        paymentStatus: PaymentStatus.failed,
        paymentRef: dto.paymentRef ?? null,
      });
      if (!updated) {
        throw new ConflictException('This booking is no longer awaiting payment.');
      }
      this.events.emit(DOMAIN_EVENTS.PAYMENT_FAILED, {
        bookingId: updated.id,
        paymentId: dto.paymentRef ?? 'unknown',
        reason: 'Payment gateway reported failure',
      });
      return updated;
    }

    const qrCode = randomBytes(16).toString('hex');
    const updated = await this.repo.updateIfStatus(booking.id, [BookingStatus.pending_payment], {
      paymentStatus: PaymentStatus.success,
      paymentRef: dto.paymentRef ?? `mock_${booking.bookingRef}`,
      status: BookingStatus.confirmed,
      qrCode,
    });
    if (!updated) {
      throw new ConflictException('This booking is no longer awaiting payment.');
    }

    this.events.emit(DOMAIN_EVENTS.PAYMENT_CAPTURED, {
      bookingId: updated.id,
      paymentId: updated.paymentRef ?? '',
      amountPaise: updated.totalAmountPaise,
    });

    this.events.emit(DOMAIN_EVENTS.BOOKING_CONFIRMED, {
      bookingId: updated.id,
      bookingRef: updated.bookingRef,
      hotelId: updated.propertyId,
      ownerId: updated.ownerId,
      roomId: updated.roomTypeId,
      guestUserId: updated.guestId,
      bookingType: updated.bookingType,
      checkIn: updated.checkInAt.toISOString(),
      checkOut: updated.checkOutAt.toISOString(),
      amountPaise: updated.totalAmountPaise,
    });

    return updated;
  }

  async getBooking(bookingId: string, user: { id: string; globalRole: GlobalRole }): Promise<Booking> {
    const booking = await this.repo.findById(bookingId);
    if (!booking) throw new NotFoundException('Booking not found');

    const isAdmin = user.globalRole === GlobalRole.SUPER_ADMIN || user.globalRole === GlobalRole.ADMIN;
    if (!isAdmin && booking.guestId !== user.id && booking.ownerId !== user.id) {
      throw new NotFoundException('Booking not found');
    }
    return booking;
  }

  async listMyBookings(guestId: string, status: BookingStatus | undefined, page: number, limit: number) {
    const [items, total] = await this.repo.findManyByGuest(guestId, status, (page - 1) * limit, limit);
    return { items, total, page, limit };
  }

  async listPropertyBookings(propertyId: string, page: number, limit: number) {
    const [items, total] = await this.repo.findManyByProperty(propertyId, (page - 1) * limit, limit);
    return { items, total, page, limit };
  }

  async checkIn(bookingId: string, dto: CheckInDto, userId: string): Promise<Booking> {
    const booking = await this.repo.findById(bookingId);
    if (!booking || booking.guestId !== userId) throw new NotFoundException('Booking not found');
    if (booking.status !== BookingStatus.confirmed) {
      throw new ConflictException('This booking cannot be checked in.');
    }
    if (!booking.qrCode) {
      throw new ConflictException('This QR code has already been used.');
    }
    if (booking.qrCode !== dto.qrCode) {
      throw new ConflictException('Invalid QR code.');
    }

    const now = new Date();
    const earliest = new Date(booking.checkInAt.getTime() - CHECK_IN_EARLY_WINDOW_MINUTES * 60 * 1000);
    const latest = new Date(booking.checkInAt.getTime() + NO_SHOW_GRACE_MINUTES * 60 * 1000);
    if (now < earliest || now > latest) {
      throw new ConflictException('Check-in window has closed for this booking.');
    }

    const updated = await this.repo.updateIfStatus(booking.id, [BookingStatus.confirmed], {
      status: BookingStatus.checked_in,
      checkedInAt: now,
      qrCode: null,
    });
    if (!updated) {
      throw new ConflictException('This booking was just updated by another request. Please refresh and try again.');
    }

    this.events.emit(DOMAIN_EVENTS.BOOKING_CHECKED_IN, {
      bookingId: updated.id,
      bookingRef: updated.bookingRef,
      hotelId: updated.propertyId,
      ownerId: updated.ownerId,
      roomId: updated.roomTypeId,
      guestUserId: updated.guestId,
      at: now.toISOString(),
    });

    return updated;
  }

  async checkOut(bookingId: string, userId: string): Promise<Booking> {
    const booking = await this.repo.findById(bookingId);
    if (!booking || booking.guestId !== userId) throw new NotFoundException('Booking not found');
    if (booking.status !== BookingStatus.checked_in) {
      throw new ConflictException('This booking has not been checked in yet.');
    }

    const now = new Date();
    const updated = await this.repo.updateIfStatus(booking.id, [BookingStatus.checked_in], {
      status: BookingStatus.completed,
      checkedOutAt: now,
    });
    if (!updated) {
      throw new ConflictException('This booking was just updated by another request. Please refresh and try again.');
    }

    this.events.emit(DOMAIN_EVENTS.BOOKING_CHECKED_OUT, {
      bookingId: updated.id,
      bookingRef: updated.bookingRef,
      hotelId: updated.propertyId,
      ownerId: updated.ownerId,
      roomId: updated.roomTypeId,
      guestUserId: updated.guestId,
      at: now.toISOString(),
    });

    return updated;
  }

  async cancel(bookingId: string, guestId: string, dto: CancelBookingDto): Promise<Booking> {
    const booking = await this.getOwnedByGuest(bookingId, guestId);
    if (booking.status !== BookingStatus.confirmed) {
      throw new ConflictException('This booking can no longer be cancelled.');
    }

    const refundAmountPaise = calculateBookingRefund(booking);
    const now = new Date();
    const updated = await this.repo.updateIfStatus(booking.id, [BookingStatus.confirmed], {
      status: BookingStatus.cancelled,
      cancelledAt: now,
      cancelledBy: 'guest',
      cancelReason: dto.reason ?? null,
      refundAmountPaise,
    });
    if (!updated) {
      throw new ConflictException('This booking can no longer be cancelled.');
    }

    this.events.emit(DOMAIN_EVENTS.BOOKING_CANCELLED, {
      bookingId: updated.id,
      bookingRef: updated.bookingRef,
      hotelId: updated.propertyId,
      ownerId: updated.ownerId,
      guestUserId: updated.guestId,
      reason: dto.reason ?? 'guest_cancelled',
      refundAmountPaise,
    });

    return updated;
  }

  // --- Scheduled lifecycle jobs (M3 spec §5) ---

  async runAutoCheckout(now: Date = new Date()): Promise<number> {
    const due = await this.repo.findCheckedInPastCheckout(now);
    let processed = 0;
    for (const booking of due) {
      // updateIfStatus guards against a concurrent guest check-out/cancel
      // racing this job (M3 spec §8: whichever commits first wins).
      const updated = await this.repo.updateIfStatus(booking.id, [BookingStatus.checked_in], {
        status: BookingStatus.completed,
        checkedOutAt: booking.checkOutAt,
      });
      if (!updated) continue;
      processed += 1;
      this.events.emit(DOMAIN_EVENTS.BOOKING_CHECKED_OUT, {
        bookingId: updated.id,
        bookingRef: updated.bookingRef,
        hotelId: updated.propertyId,
        ownerId: updated.ownerId,
        roomId: updated.roomTypeId,
        guestUserId: updated.guestId,
        at: updated.checkOutAt.toISOString(),
      });
    }
    return processed;
  }

  async runNoShowDetection(now: Date = new Date()): Promise<number> {
    const graceDeadline = new Date(now.getTime() - NO_SHOW_GRACE_MINUTES * 60 * 1000);
    const due = await this.repo.findConfirmedPastNoShowGrace(graceDeadline);
    let processed = 0;
    for (const booking of due) {
      const updated = await this.repo.updateIfStatus(booking.id, [BookingStatus.confirmed], {
        status: BookingStatus.no_show,
        noShowAt: now,
      });
      if (!updated) continue;
      processed += 1;
      this.events.emit(DOMAIN_EVENTS.BOOKING_NO_SHOW, {
        bookingId: updated.id,
        bookingRef: updated.bookingRef,
        hotelId: updated.propertyId,
        ownerId: updated.ownerId,
        guestUserId: updated.guestId,
        reason: 'Guest did not check in within the 30-minute grace period.',
      });
    }
    return processed;
  }

  async runPaymentTimeouts(now: Date = new Date()): Promise<number> {
    const cutoff = new Date(now.getTime() - PAYMENT_TIMEOUT_MINUTES * 60 * 1000);
    const due = await this.repo.findPendingPaymentTimedOut(cutoff);
    let processed = 0;
    for (const booking of due) {
      const updated = await this.repo.updateIfStatus(booking.id, [BookingStatus.pending_payment], {
        status: BookingStatus.cancelled,
        cancelledAt: now,
        cancelledBy: 'system',
        cancelReason: 'payment_timeout',
        refundAmountPaise: 0,
      });
      if (!updated) continue;
      processed += 1;
      this.events.emit(DOMAIN_EVENTS.BOOKING_CANCELLED, {
        bookingId: updated.id,
        bookingRef: updated.bookingRef,
        hotelId: updated.propertyId,
        ownerId: updated.ownerId,
        guestUserId: updated.guestId,
        reason: 'payment_timeout',
        refundAmountPaise: 0,
      });
    }
    return processed;
  }

  private assertBookingTypeAllowed(requested: BookingType, policy: BookingPolicy | null): void {
    if (!policy) {
      throw new BadRequestException('This property has not configured a booking policy.');
    }
    if (policy === BookingPolicy.both) return;
    if ((policy as string) !== (requested as string)) {
      throw new BadRequestException(`This property only accepts ${policy} bookings.`);
    }
  }

  private async getOwnedByGuest(bookingId: string, guestId: string): Promise<Booking> {
    const booking = await this.repo.findById(bookingId);
    if (!booking || booking.guestId !== guestId) {
      throw new NotFoundException('Booking not found');
    }
    return booking;
  }
}

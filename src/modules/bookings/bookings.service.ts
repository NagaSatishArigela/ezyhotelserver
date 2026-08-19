import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Booking, BookingPolicy, BookingStatus, BookingType, GlobalRole, PropertyStatus } from '@prisma/client';
import { DOMAIN_EVENTS } from '../../common/events/domain-events';
import { TypedEventEmitter } from '../../common/events/typed-event-emitter.service';
import { PlatformConfigService } from '../platform/platform-config.service';
import { BookingsRepository, SlotUnavailableError } from './bookings.repository';
import { CancelBookingDto } from './dto/cancel-booking.dto';
import { CheckInDto } from './dto/check-in.dto';
import { CreateBookingDto } from './dto/create-booking.dto';

const GST_RATE = 0.18;
const NO_SHOW_GRACE_MINUTES = 30;
const CHECK_IN_EARLY_WINDOW_MINUTES = 15;
const PAYMENT_TIMEOUT_MINUTES = 30;
const DEFAULT_MIN_BOOKING_HOURS = 3;
const FULLDAY_DURATION_HOURS = 24;
// A booking's check-in must be roughly "now or later" (a small grace absorbs
// client/server clock skew and in-flight requests) and no further out than a
// sane horizon — reject stale dates (yesterday) and absurd ones (year 2100).
const BOOKING_PAST_GRACE_MINUTES = 10;
const BOOKING_HORIZON_DAYS = 90;

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
    private readonly platformConfig: PlatformConfigService,
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

    const nowMs = Date.now();
    if (checkInAt.getTime() < nowMs - BOOKING_PAST_GRACE_MINUTES * 60 * 1000) {
      throw new BadRequestException('checkInAt cannot be in the past.');
    }
    if (checkInAt.getTime() > nowMs + BOOKING_HORIZON_DAYS * 24 * 60 * 60 * 1000) {
      throw new BadRequestException(`checkInAt cannot be more than ${BOOKING_HORIZON_DAYS} days in the future.`);
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
    // Platform commission = commissionPct of the base tariff (from PlatformSettings).
    // It is the platform's cut, DEDUCTED from the owner's payout downstream
    // (payouts: ownerGross = base − platformFee − refund) — NOT added on top of
    // what the guest pays. The guest is charged base + GST only.
    const { commissionPct } = await this.platformConfig.getMoneyConfig();
    const platformFeePaise = this.platformConfig.commissionPaise(baseAmountPaise, commissionPct);
    const totalAmountPaise = baseAmountPaise + gstAmountPaise;

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
          guestName: dto.guestName ?? null,
          guestPhone: dto.guestPhone ?? null,
          guestEmail: dto.guestEmail ?? null,
          specialRequests: dto.specialRequests ?? null,
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

  // Owner dashboard: headline counts + this-week revenue + 5 most-recent bookings.
  async getOwnerDashboard(propertyId: string) {
    const now = new Date();
    const todayStart = new Date(now); todayStart.setHours(0, 0, 0, 0);
    const todayEnd = new Date(now); todayEnd.setHours(23, 59, 59, 999);
    const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);

    const stats = await this.repo.dashboardStats(propertyId, todayStart, todayEnd, weekAgo, now);
    const [recent] = await this.repo.findManyByProperty(propertyId, 0, 5);
    return { ...stats, recent };
  }

  // Owner analytics over a look-back window: daily revenue, mix by type/status,
  // and headline totals. Aggregated in-memory (demo/pilot scale).
  async getOwnerAnalytics(propertyId: string, days: number) {
    const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
    const rows = await this.repo.findForAnalytics(propertyId, since);

    const earning = new Set<BookingStatus>([
      BookingStatus.confirmed,
      BookingStatus.checked_in,
      BookingStatus.completed,
    ]);
    const revenueByDayMap = new Map<string, number>();
    const byType: Record<string, number> = { hourly: 0, fullday: 0 };
    const byStatus: Record<string, number> = {};
    let revenuePaise = 0;
    let earningCount = 0;

    for (const r of rows) {
      byStatus[r.status] = (byStatus[r.status] ?? 0) + 1;
      byType[r.bookingType] = (byType[r.bookingType] ?? 0) + 1;
      if (earning.has(r.status)) {
        revenuePaise += r.totalAmountPaise;
        earningCount += 1;
        const day = r.createdAt.toISOString().slice(0, 10);
        revenueByDayMap.set(day, (revenueByDayMap.get(day) ?? 0) + r.totalAmountPaise);
      }
    }

    return {
      days,
      totals: {
        bookings: rows.length,
        revenuePaise,
        avgBookingValuePaise: earningCount > 0 ? Math.round(revenuePaise / earningCount) : 0,
      },
      byType,
      byStatus,
      revenueByDay: [...revenueByDayMap.entries()].map(([date, paise]) => ({ date, revenuePaise: paise })),
    };
  }

  async checkIn(bookingId: string, dto: CheckInDto, userId: string): Promise<Booking> {
    // FLAG (Layer-C follow-up, not fixed here): check-in is gated on
    // booking.guestId === userId, so the guest scans/enters the QR that was
    // returned to them and self-marks the booking checked_in. Physical
    // check-in should instead be owner/staff-scoped (the property verifies the
    // guest's QR), i.e. authorize userId against the property's owner/staff
    // roles rather than the guest. Same concern in checkOut() below.
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

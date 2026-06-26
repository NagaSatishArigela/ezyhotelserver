import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import {
  Booking,
  BookingAdminAction,
  BookingAdminActionType,
  BookingStatus,
  BookingType,
  PaymentStatus,
} from '@prisma/client';
import { DOMAIN_EVENTS } from '../../../common/events/domain-events';
import { TypedEventEmitter } from '../../../common/events/typed-event-emitter.service';
import { BookingsRepository } from '../bookings.repository';
import { calculateBookingRefund } from '../bookings.service';
import {
  AdminCancelBookingDto,
  ExtendBookingDto,
  FlagBookingDto,
  ForceCheckoutBookingDto,
  RefundBookingDto,
  VoidBookingDto,
} from './dto/admin-booking-actions.dto';
import {
  AdminBookingKpisQueryDto,
  ListAdminBookingsQueryDto,
} from './dto/list-admin-bookings-query.dto';
import { AdminBookingFilters, AdminBookingRow, AdminBookingsRepository } from './admin-bookings.repository';

const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;
const REFUNDABLE_STATUSES: BookingStatus[] = [
  BookingStatus.confirmed,
  BookingStatus.checked_in,
  BookingStatus.completed,
];

export interface AdminBookingListItem {
  id: string;
  bookingRef: string;
  propertyId: string;
  propertyName: string | null;
  city: string | null;
  roomTypeId: string;
  ownerId: string;
  guestId: string;
  guestPhone: string | null;
  bookingType: BookingType;
  checkInAt: Date;
  checkOutAt: Date;
  durationHours: number;
  guestCount: number;
  totalAmountPaise: number;
  status: BookingStatus;
  paymentStatus: PaymentStatus;
  refundAmountPaise: number | null;
  isFlagged: boolean;
  createdAt: Date;
}

export interface AdminActiveBookingItem extends AdminBookingListItem {
  timeRemainingSeconds: number;
  isOverdue: boolean;
}

export interface AdminBookingListResult {
  items: AdminBookingListItem[];
  total: number;
  page: number;
  limit: number;
}

export interface AdminBookingKpis {
  totalBookings: number;
  totalGbvPaise: number;
  cancellationRate: number;
  avgBookingValuePaise: number;
  noShowRate: number;
}

export interface TimelineEntry {
  at: Date;
  label: string;
  detail?: string;
}

export interface AdminBookingDetail {
  booking: Booking;
  property: { id: string; name: string; city: string; area: string | null };
  guest: { id: string; phone: string; email: string };
  timeline: TimelineEntry[];
  adminActions: BookingAdminAction[];
}

function mapRow(row: AdminBookingRow): AdminBookingListItem {
  return {
    id: row.id,
    bookingRef: row.booking_ref,
    propertyId: row.property_id,
    propertyName: row.property_name,
    city: row.city,
    roomTypeId: row.room_type_id,
    ownerId: row.owner_id,
    guestId: row.guest_id,
    guestPhone: row.guest_phone,
    bookingType: row.booking_type,
    checkInAt: row.check_in_at,
    checkOutAt: row.check_out_at,
    durationHours: row.duration_hours,
    guestCount: row.guest_count,
    totalAmountPaise: row.total_amount_paise,
    status: row.status,
    paymentStatus: row.payment_status as PaymentStatus,
    refundAmountPaise: row.refund_amount_paise,
    isFlagged: row.is_flagged,
    createdAt: row.created_at,
  };
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

@Injectable()
export class AdminBookingsService {
  constructor(
    private readonly bookingsRepo: BookingsRepository,
    private readonly repo: AdminBookingsRepository,
    private readonly events: TypedEventEmitter,
  ) {}

  /** GET /admin/bookings (M5 spec §3.1). */
  async list(query: ListAdminBookingsQueryDto): Promise<AdminBookingListResult> {
    const filters = this.buildFilters(query);
    const { items, total } = await this.repo.findManyForAdmin(
      filters,
      (query.page - 1) * query.limit,
      query.limit,
      query.sort,
      query.order,
    );
    return { items: items.map(mapRow), total, page: query.page, limit: query.limit };
  }

  /** GET /admin/bookings/kpis (M5 spec §3.2). */
  async kpis(query: AdminBookingKpisQueryDto): Promise<AdminBookingKpis> {
    const filters = this.buildFilters(query);
    const row = await this.repo.getKpis(filters);

    const totalBookings = Number(row.total_bookings);
    const totalGbvPaise = Number(row.total_gbv_paise ?? 0);
    const cancelledCount = Number(row.cancelled_count);
    const noShowCount = Number(row.no_show_count);

    return {
      totalBookings,
      totalGbvPaise,
      cancellationRate: totalBookings > 0 ? round2((cancelledCount / totalBookings) * 100) : 0,
      avgBookingValuePaise: totalBookings > 0 ? Math.round(totalGbvPaise / totalBookings) : 0,
      noShowRate: totalBookings > 0 ? round2((noShowCount / totalBookings) * 100) : 0,
    };
  }

  /** GET /admin/bookings/active (M5 spec §3.3). */
  async active(): Promise<AdminActiveBookingItem[]> {
    const rows = await this.repo.findActive();
    const now = Date.now();
    return rows.map((row) => {
      const item = mapRow(row);
      const timeRemainingSeconds = Math.round((item.checkOutAt.getTime() - now) / 1000);
      return { ...item, timeRemainingSeconds, isOverdue: timeRemainingSeconds < 0 };
    });
  }

  /** GET /admin/bookings/:id (M5 spec §3.4). */
  async getDetail(id: string): Promise<AdminBookingDetail> {
    const booking = await this.findOrThrow(id);

    const [property, guest, adminActions] = await Promise.all([
      this.repo.findPropertyArea(booking.propertyId),
      this.repo.findGuestContact(booking.guestId),
      this.repo.findAdminActions(id),
    ]);

    return {
      booking,
      property: property ?? { id: booking.propertyId, name: '', city: '', area: null },
      guest: guest
        ? { id: booking.guestId, phone: guest.phone, email: guest.email }
        : { id: booking.guestId, phone: '', email: '' },
      timeline: this.buildTimeline(booking, adminActions),
      adminActions,
    };
  }

  /** POST /admin/bookings/:id/void (M5 spec §3.5). */
  async void(id: string, adminId: string, dto: VoidBookingDto): Promise<Booking> {
    const booking = await this.findOrThrow(id);
    const now = new Date();
    const reason = dto.reasonText ?? dto.reasonCategory;

    const updated = await this.bookingsRepo.updateIfStatus(id, [BookingStatus.confirmed], {
      status: BookingStatus.voided,
      voidedAt: now,
      voidedBy: adminId,
      voidReason: reason,
      paymentStatus: PaymentStatus.refunded,
      refundAmountPaise: booking.totalAmountPaise,
    });
    if (!updated) {
      throw new ConflictException(
        'This booking was just checked in by the guest. You can no longer void it.',
      );
    }

    await this.repo.createAdminAction({
      bookingId: id,
      adminId,
      action: BookingAdminActionType.void,
      reasonCategory: dto.reasonCategory,
      reasonText: dto.reasonText ?? null,
      metadata: { refundAmountPaise: updated.totalAmountPaise },
    });

    this.events.emit(DOMAIN_EVENTS.BOOKING_VOIDED, {
      bookingId: updated.id,
      bookingRef: updated.bookingRef,
      hotelId: updated.propertyId,
      ownerId: updated.ownerId,
      guestUserId: updated.guestId,
      voidedBy: adminId,
      reason,
      refundAmountPaise: updated.totalAmountPaise,
    });

    return updated;
  }

  /** POST /admin/bookings/:id/cancel (M5 spec §3.5). */
  async cancel(id: string, adminId: string, dto: AdminCancelBookingDto): Promise<Booking> {
    const booking = await this.findOrThrow(id);
    const refundAmountPaise = calculateBookingRefund(booking);
    const now = new Date();
    const reason = dto.reasonText ?? dto.reasonCategory;

    const updated = await this.bookingsRepo.updateIfStatus(id, [BookingStatus.confirmed], {
      status: BookingStatus.cancelled,
      cancelledAt: now,
      cancelledBy: `admin:${adminId}`,
      cancelReason: reason,
      refundAmountPaise,
    });
    if (!updated) {
      throw new ConflictException('This booking can no longer be cancelled.');
    }

    await this.repo.createAdminAction({
      bookingId: id,
      adminId,
      action: BookingAdminActionType.cancel,
      reasonCategory: dto.reasonCategory,
      reasonText: dto.reasonText ?? null,
      metadata: { refundAmountPaise },
    });

    this.events.emit(DOMAIN_EVENTS.BOOKING_CANCELLED, {
      bookingId: updated.id,
      bookingRef: updated.bookingRef,
      hotelId: updated.propertyId,
      ownerId: updated.ownerId,
      guestUserId: updated.guestId,
      reason,
      refundAmountPaise,
    });

    return updated;
  }

  /** POST /admin/bookings/:id/refund (M5 spec §3.5). */
  async refund(id: string, adminId: string, dto: RefundBookingDto): Promise<Booking> {
    const booking = await this.findOrThrow(id);
    if (!REFUNDABLE_STATUSES.includes(booking.status)) {
      throw new ConflictException('This booking cannot be refunded in its current state.');
    }

    const alreadyRefunded = booking.refundAmountPaise ?? 0;
    const remaining = booking.totalAmountPaise - alreadyRefunded;
    if (dto.amountPaise > remaining) {
      throw new BadRequestException(
        `Refund amount cannot exceed ₹${(remaining / 100).toFixed(2)} (remaining refundable balance).`,
      );
    }

    const newRefundAmountPaise = alreadyRefunded + dto.amountPaise;
    const isPartial = newRefundAmountPaise < booking.totalAmountPaise;

    const updated = await this.bookingsRepo.updateIfStatus(id, [booking.status], {
      refundAmountPaise: newRefundAmountPaise,
      paymentStatus: PaymentStatus.refunded,
    });
    if (!updated) {
      throw new ConflictException(
        'This booking was just updated by another request. Please refresh and try again.',
      );
    }

    await this.repo.createAdminAction({
      bookingId: id,
      adminId,
      action: isPartial ? BookingAdminActionType.refund_partial : BookingAdminActionType.refund_full,
      reasonCategory: dto.reasonCategory,
      reasonText: dto.reasonText ?? null,
      metadata: { amountPaise: dto.amountPaise, isPartial },
    });

    this.events.emit(DOMAIN_EVENTS.BOOKING_REFUNDED, {
      bookingId: updated.id,
      bookingRef: updated.bookingRef,
      hotelId: updated.propertyId,
      ownerId: updated.ownerId,
      guestUserId: updated.guestId,
      amountPaise: dto.amountPaise,
      isPartial,
      reason: dto.reasonText ?? dto.reasonCategory,
    });

    return updated;
  }

  /** POST /admin/bookings/:id/force-checkout (M5 spec §3.5). */
  async forceCheckout(id: string, adminId: string, dto: ForceCheckoutBookingDto): Promise<Booking> {
    const booking = await this.findOrThrow(id);
    const now = new Date();

    const updated = await this.bookingsRepo.updateIfStatus(id, [BookingStatus.checked_in], {
      status: BookingStatus.completed,
      checkedOutAt: now,
    });
    if (!updated) {
      throw new ConflictException('This booking is not currently checked in.');
    }

    const overstayMinutes = Math.round((now.getTime() - booking.checkOutAt.getTime()) / (60 * 1000));

    await this.repo.createAdminAction({
      bookingId: id,
      adminId,
      action: BookingAdminActionType.force_checkout,
      reasonText: dto.reasonText,
      metadata: overstayMinutes > 0 ? { overstayMinutes } : {},
    });

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

  /** POST /admin/bookings/:id/extend (M5 spec §3.5). */
  async extend(id: string, adminId: string, dto: ExtendBookingDto): Promise<Booking> {
    const booking = await this.findOrThrow(id);
    if (booking.status !== BookingStatus.checked_in) {
      throw new ConflictException('This booking is not currently checked in.');
    }

    const newCheckOutAt = new Date(dto.newCheckOutAt);
    if (Number.isNaN(newCheckOutAt.getTime()) || newCheckOutAt <= booking.checkOutAt) {
      throw new BadRequestException(
        'newCheckOutAt must be a valid timestamp after the current check-out time.',
      );
    }

    const overlaps = await this.bookingsRepo.hasOverlap(
      booking.roomTypeId,
      booking.checkOutAt,
      newCheckOutAt,
      booking.id,
    );
    if (overlaps) {
      throw new ConflictException('This extension is not available — the room is booked for that time.');
    }

    const durationHours = Math.round((newCheckOutAt.getTime() - booking.checkInAt.getTime()) / (60 * 60 * 1000));

    const updated = await this.bookingsRepo.updateIfStatus(id, [BookingStatus.checked_in], {
      checkOutAt: newCheckOutAt,
      durationHours,
      extensionAmountPaise: dto.extensionAmountPaise,
      totalAmountPaise: booking.totalAmountPaise + dto.extensionAmountPaise,
    });
    if (!updated) {
      throw new ConflictException(
        'This booking was just updated by another request. Please refresh and try again.',
      );
    }

    await this.repo.createAdminAction({
      bookingId: id,
      adminId,
      action: BookingAdminActionType.extend,
      metadata: {
        previousCheckOutAt: booking.checkOutAt.toISOString(),
        newCheckOutAt: newCheckOutAt.toISOString(),
        extensionAmountPaise: dto.extensionAmountPaise,
      },
    });

    this.events.emit(DOMAIN_EVENTS.BOOKING_EXTENDED, {
      bookingId: updated.id,
      bookingRef: updated.bookingRef,
      hotelId: updated.propertyId,
      ownerId: updated.ownerId,
      guestUserId: updated.guestId,
      newCheckOutAt: newCheckOutAt.toISOString(),
      extensionAmountPaise: dto.extensionAmountPaise,
    });

    return updated;
  }

  /** POST /admin/bookings/:id/flag (M5 spec §3.5). */
  async flag(id: string, adminId: string, dto: FlagBookingDto): Promise<Booking> {
    await this.findOrThrow(id);

    const updated = await this.bookingsRepo.update(id, {
      isFlagged: true,
      flagType: dto.flagType,
      flagNotes: dto.flagNotes ?? null,
    });

    await this.repo.createAdminAction({
      bookingId: id,
      adminId,
      action: BookingAdminActionType.flag,
      metadata: { flagType: dto.flagType, flagNotes: dto.flagNotes ?? null },
    });

    this.events.emit(DOMAIN_EVENTS.BOOKING_FLAGGED, {
      bookingId: updated.id,
      bookingRef: updated.bookingRef,
      hotelId: updated.propertyId,
      flagType: dto.flagType,
      flagNotes: dto.flagNotes ?? null,
    });

    return updated;
  }

  /** POST /admin/bookings/:id/unflag (M5 spec §3.5). */
  async unflag(id: string, adminId: string): Promise<Booking> {
    const booking = await this.findOrThrow(id);
    if (!booking.isFlagged) {
      throw new ConflictException('This booking is not flagged.');
    }

    const updated = await this.bookingsRepo.update(id, {
      isFlagged: false,
      flagType: null,
      flagNotes: null,
    });

    await this.repo.createAdminAction({
      bookingId: id,
      adminId,
      action: BookingAdminActionType.unflag,
    });

    return updated;
  }

  private buildFilters(query: ListAdminBookingsQueryDto | AdminBookingKpisQueryDto): AdminBookingFilters {
    if (query.amountMin != null && query.amountMax != null && query.amountMin > query.amountMax) {
      throw new BadRequestException('amountMin cannot exceed amountMax.');
    }

    const now = new Date();
    return {
      dateFrom: query.dateFrom ? new Date(query.dateFrom) : new Date(now.getTime() - SEVEN_DAYS_MS),
      dateTo: query.dateTo ? new Date(query.dateTo) : now,
      city: query.city,
      propertyId: query.propertyId,
      bookingType: query.bookingType,
      status: query.status,
      amountMin: query.amountMin,
      amountMax: query.amountMax,
      guestPhone: query.guestPhone,
      bookingRef: query.bookingRef,
    };
  }

  private async findOrThrow(id: string): Promise<Booking> {
    const booking = await this.bookingsRepo.findById(id);
    if (!booking) throw new NotFoundException('Booking not found');
    return booking;
  }

  // Derived status timeline (M5 spec §3.4.1) - built from existing Booking
  // timestamps plus admin-action rows for events with no dedicated column.
  private buildTimeline(booking: Booking, adminActions: BookingAdminAction[]): TimelineEntry[] {
    const entries: TimelineEntry[] = [];

    entries.push({ at: booking.createdAt, label: 'Created' });

    if (booking.checkedInAt) {
      entries.push({ at: booking.checkedInAt, label: 'Checked In' });
    }

    if (booking.checkedOutAt) {
      const wasForced = adminActions.some((a) => a.action === BookingAdminActionType.force_checkout);
      entries.push({
        at: booking.checkedOutAt,
        label: wasForced ? 'Force-Checked-Out' : 'Completed',
      });
    }

    if (booking.cancelledAt) {
      entries.push({ at: booking.cancelledAt, label: 'Cancelled', detail: booking.cancelReason ?? undefined });
    }

    if (booking.voidedAt) {
      entries.push({ at: booking.voidedAt, label: 'Voided', detail: booking.voidReason ?? undefined });
    }

    if (booking.noShowAt) {
      entries.push({ at: booking.noShowAt, label: 'No-Show' });
    }

    for (const action of adminActions) {
      const label = this.adminActionLabel(action);
      if (label) {
        entries.push({ at: action.createdAt, label, detail: action.reasonText ?? undefined });
      }
    }

    return entries.sort((a, b) => a.at.getTime() - b.at.getTime());
  }

  private adminActionLabel(action: BookingAdminAction): string | null {
    const metadata = (action.metadata ?? {}) as Record<string, unknown>;
    switch (action.action) {
      case BookingAdminActionType.refund_full:
      case BookingAdminActionType.refund_partial: {
        const amount = Number(metadata.amountPaise ?? 0) / 100;
        const kind = action.action === BookingAdminActionType.refund_full ? 'Full' : 'Partial';
        return `Refund — ₹${amount.toFixed(2)} (${kind})`;
      }
      case BookingAdminActionType.extend: {
        const newCheckOutAt = metadata.newCheckOutAt as string | undefined;
        return newCheckOutAt
          ? `Extended to ${new Date(newCheckOutAt).toLocaleString('en-IN')}`
          : 'Extended';
      }
      case BookingAdminActionType.flag:
        return `Flagged: ${String(metadata.flagType ?? 'unspecified')}`;
      case BookingAdminActionType.unflag:
        return 'Unflagged';
      // void/cancel are already represented via voidedAt/cancelledAt above.
      default:
        return null;
    }
  }
}

import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { NotificationType } from '@prisma/client';
import {
  BookingCancelledPayload,
  BookingCheckInOutPayload,
  BookingCreatedPayload,
  BookingExtendedPayload,
  BookingRefundedPayload,
  BookingVoidedPayload,
  DOMAIN_EVENTS,
} from '../../../common/events/domain-events';
import { TypedEventEmitter } from '../../../common/events/typed-event-emitter.service';
import { NotificationsRepository } from '../notifications.repository';

const OWNER_BOOKINGS_URL = '/owner/dashboard/bookings';

/**
 * M3 spec §1/§2.2: subscribes to booking.* events and writes owner-facing
 * `booking_update` notifications, mirroring PropertyStatusListener.
 */
@Injectable()
export class BookingStatusListener implements OnModuleInit {
  private readonly logger = new Logger(BookingStatusListener.name);

  constructor(
    private readonly repo: NotificationsRepository,
    private readonly events: TypedEventEmitter,
  ) {}

  private wrap<T>(eventName: string, handler: (p: T) => Promise<void>): (p: T) => void {
    return (payload: T) => {
      handler(payload).catch((err: unknown) => {
        this.logger.error(`[${eventName}] listener failed: ${err instanceof Error ? err.message : String(err)}`);
      });
    };
  }

  onModuleInit(): void {
    this.events.on(DOMAIN_EVENTS.BOOKING_CONFIRMED,  this.wrap('booking.confirmed',  (p) => this.onConfirmed(p)));
    this.events.on(DOMAIN_EVENTS.BOOKING_CANCELLED,  this.wrap('booking.cancelled',  (p) => this.onCancelled(p)));
    this.events.on(DOMAIN_EVENTS.BOOKING_NO_SHOW,    this.wrap('booking.no_show',    (p) => this.onNoShow(p)));
    this.events.on(DOMAIN_EVENTS.BOOKING_CHECKED_IN, this.wrap('booking.checked_in', (p) => this.onCheckedIn(p)));
    this.events.on(DOMAIN_EVENTS.BOOKING_VOIDED,     this.wrap('booking.voided',     (p) => this.onVoided(p)));
    this.events.on(DOMAIN_EVENTS.BOOKING_REFUNDED,   this.wrap('booking.refunded',   (p) => this.onRefunded(p)));
    this.events.on(DOMAIN_EVENTS.BOOKING_EXTENDED,   this.wrap('booking.extended',   (p) => this.onExtended(p)));
  }

  private async onConfirmed(payload: BookingCreatedPayload): Promise<void> {
    await this.repo.create({
      ownerId: payload.ownerId,
      propertyId: payload.hotelId,
      type: NotificationType.booking_update,
      title: 'New booking confirmed',
      body: `Booking ${payload.bookingRef} has been confirmed for ${new Date(payload.checkIn).toLocaleString('en-IN')}.`,
      actionUrl: OWNER_BOOKINGS_URL,
    });

    this.events.emit(DOMAIN_EVENTS.NOTIFICATION_REQUESTED, {
      channel: 'email',
      templateId: 'booking_confirmed',
      recipientUserId: payload.guestUserId,
      data: { bookingRef: payload.bookingRef },
    });
  }

  private async onCancelled(payload: BookingCancelledPayload): Promise<void> {
    await this.repo.create({
      ownerId: payload.ownerId,
      propertyId: payload.hotelId,
      type: NotificationType.booking_update,
      title: 'Booking cancelled',
      body: `Booking ${payload.bookingRef} was cancelled. Reason: ${payload.reason}.`,
      actionUrl: OWNER_BOOKINGS_URL,
    });

    this.events.emit(DOMAIN_EVENTS.NOTIFICATION_REQUESTED, {
      channel: 'email',
      templateId: 'booking_cancelled',
      recipientUserId: payload.guestUserId,
      data: { bookingRef: payload.bookingRef, refundAmountPaise: payload.refundAmountPaise ?? 0 },
    });
  }

  private async onNoShow(payload: BookingCancelledPayload): Promise<void> {
    await this.repo.create({
      ownerId: payload.ownerId,
      propertyId: payload.hotelId,
      type: NotificationType.booking_update,
      title: 'Guest marked as no-show',
      body: `Booking ${payload.bookingRef} was marked as a no-show.`,
      actionUrl: OWNER_BOOKINGS_URL,
    });
  }

  private async onCheckedIn(payload: BookingCheckInOutPayload): Promise<void> {
    await this.repo.create({
      ownerId: payload.ownerId,
      propertyId: payload.hotelId,
      type: NotificationType.booking_update,
      title: 'Guest checked in',
      body: `Booking ${payload.bookingRef} - guest has checked in.`,
      actionUrl: OWNER_BOOKINGS_URL,
    });
  }

  private async onVoided(payload: BookingVoidedPayload): Promise<void> {
    await this.repo.create({
      ownerId: payload.ownerId,
      propertyId: payload.hotelId,
      type: NotificationType.booking_update,
      title: 'Booking voided',
      body: `Booking ${payload.bookingRef} was voided by the platform. Reason: ${payload.reason}.`,
      actionUrl: OWNER_BOOKINGS_URL,
    });

    this.events.emit(DOMAIN_EVENTS.NOTIFICATION_REQUESTED, {
      channel: 'email',
      templateId: 'booking_voided',
      recipientUserId: payload.guestUserId,
      data: { bookingRef: payload.bookingRef, reason: payload.reason, refundAmountPaise: payload.refundAmountPaise },
    });
  }

  private async onRefunded(payload: BookingRefundedPayload): Promise<void> {
    await this.repo.create({
      ownerId: payload.ownerId,
      propertyId: payload.hotelId,
      type: NotificationType.booking_update,
      title: 'Refund issued',
      body: `Booking ${payload.bookingRef} - a ${payload.isPartial ? 'partial' : 'full'} refund of ₹${(payload.amountPaise / 100).toFixed(2)} was issued.`,
      actionUrl: OWNER_BOOKINGS_URL,
    });

    this.events.emit(DOMAIN_EVENTS.NOTIFICATION_REQUESTED, {
      channel: 'email',
      templateId: 'booking_refunded',
      recipientUserId: payload.guestUserId,
      data: { bookingRef: payload.bookingRef, amountPaise: payload.amountPaise, isPartial: payload.isPartial },
    });
  }

  private async onExtended(payload: BookingExtendedPayload): Promise<void> {
    await this.repo.create({
      ownerId: payload.ownerId,
      propertyId: payload.hotelId,
      type: NotificationType.booking_update,
      title: 'Booking extended',
      body: `Booking ${payload.bookingRef} was extended to ${new Date(payload.newCheckOutAt).toLocaleString('en-IN')}.`,
      actionUrl: OWNER_BOOKINGS_URL,
    });

    this.events.emit(DOMAIN_EVENTS.NOTIFICATION_REQUESTED, {
      channel: 'email',
      templateId: 'booking_extended',
      recipientUserId: payload.guestUserId,
      data: { bookingRef: payload.bookingRef, newCheckOutAt: payload.newCheckOutAt },
    });
  }
}

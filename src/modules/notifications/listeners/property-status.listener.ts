import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { NotificationType } from '@prisma/client';
import {
  DOMAIN_EVENTS,
  HotelRejectedPayload,
  HotelRevisionRequestedPayload,
  HotelVerifiedPayload,
} from '../../../common/events/domain-events';
import { TypedEventEmitter } from '../../../common/events/typed-event-emitter.service';
import { NotificationsRepository } from '../notifications.repository';

const DASHBOARD_URL = '/owner/dashboard';
const DOCUMENTS_URL = '/owner/dashboard/documents';

/**
 * M2 spec §3.2: subscribes to `hotel.verified` / `hotel.rejected` /
 * `hotel.revision_requested` (emitted by M2B's admin moderation endpoints),
 * creates the corresponding owner_notifications row, and emits
 * `notification.requested` for the matching P0 email/SMS template
 * (Updated_Onboarding_Spec.docx §9).
 */
@Injectable()
export class PropertyStatusListener implements OnModuleInit {
  private readonly logger = new Logger(PropertyStatusListener.name);

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
    this.events.on(DOMAIN_EVENTS.HOTEL_VERIFIED,           this.wrap('hotel.verified',           (p) => this.onVerified(p)));
    this.events.on(DOMAIN_EVENTS.HOTEL_REJECTED,           this.wrap('hotel.rejected',           (p) => this.onRejected(p)));
    this.events.on(DOMAIN_EVENTS.HOTEL_REVISION_REQUESTED, this.wrap('hotel.revision_requested', (p) => this.onRevisionRequested(p)));
  }

  private async onVerified(payload: HotelVerifiedPayload): Promise<void> {
    await this.repo.create({
      ownerId: payload.ownerId,
      propertyId: payload.hotelId,
      type: NotificationType.approval,
      title: 'Your property is now live!',
      body: 'Congratulations! Your property has been approved and is now live on PayPerHour.',
      actionUrl: DASHBOARD_URL,
    });

    this.events.emit(DOMAIN_EVENTS.NOTIFICATION_REQUESTED, {
      channel: 'email',
      templateId: 'property_approved',
      recipientUserId: payload.ownerId,
      data: { hotelId: payload.hotelId },
    });
    this.events.emit(DOMAIN_EVENTS.NOTIFICATION_REQUESTED, {
      channel: 'sms',
      templateId: 'property_approved',
      recipientUserId: payload.ownerId,
      data: { hotelId: payload.hotelId },
    });
  }

  private async onRejected(payload: HotelRejectedPayload): Promise<void> {
    await this.repo.create({
      ownerId: payload.ownerId,
      propertyId: payload.hotelId,
      type: NotificationType.rejection,
      title: 'Update on your property submission',
      body: `Your property submission was not approved. Reason: ${payload.reason}`,
      actionUrl: DASHBOARD_URL,
    });

    this.events.emit(DOMAIN_EVENTS.NOTIFICATION_REQUESTED, {
      channel: 'email',
      templateId: 'property_rejected',
      recipientUserId: payload.ownerId,
      data: { hotelId: payload.hotelId, reason: payload.reason },
    });
  }

  private async onRevisionRequested(payload: HotelRevisionRequestedPayload): Promise<void> {
    const summary = payload.items.map((item) => `${item.field}: ${item.reason}`).join('; ');

    await this.repo.create({
      ownerId: payload.ownerId,
      propertyId: payload.hotelId,
      type: NotificationType.revision_request,
      title: 'Action needed: please update your property submission',
      body: summary,
      actionUrl: DOCUMENTS_URL,
    });

    this.events.emit(DOMAIN_EVENTS.NOTIFICATION_REQUESTED, {
      channel: 'email',
      templateId: 'revision_requested',
      recipientUserId: payload.ownerId,
      data: { hotelId: payload.hotelId, items: JSON.stringify(payload.items) },
    });
    this.events.emit(DOMAIN_EVENTS.NOTIFICATION_REQUESTED, {
      channel: 'sms',
      templateId: 'revision_requested',
      recipientUserId: payload.ownerId,
      data: { hotelId: payload.hotelId },
    });
  }
}

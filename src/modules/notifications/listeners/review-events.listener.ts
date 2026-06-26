import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { NotificationType } from '@prisma/client';
import { DOMAIN_EVENTS, ReviewNewOnPropertyPayload } from '../../../common/events/domain-events';
import { TypedEventEmitter } from '../../../common/events/typed-event-emitter.service';
import { NotificationsRepository } from '../notifications.repository';

@Injectable()
export class ReviewEventsListener implements OnModuleInit {
  private readonly logger = new Logger(ReviewEventsListener.name);

  constructor(
    private readonly repo: NotificationsRepository,
    private readonly events: TypedEventEmitter,
  ) {}

  onModuleInit(): void {
    this.events.on(DOMAIN_EVENTS.REVIEW_NEW_ON_PROPERTY, (payload) => {
      this.onNewReview(payload).catch((err: unknown) => {
        this.logger.error(`[review.new_on_property] listener failed: ${err instanceof Error ? err.message : String(err)}`);
      });
    });
  }

  private async onNewReview(payload: ReviewNewOnPropertyPayload): Promise<void> {
    await this.repo.create({
      ownerId: payload.ownerId,
      propertyId: payload.propertyId,
      type: NotificationType.review_new_on_property,
      title: 'New review on your property',
      body: `A guest left a ${payload.scoreOverall}/5 review. Reply within 96 hours.`,
      actionUrl: '/owner/reviews',
    });
  }
}

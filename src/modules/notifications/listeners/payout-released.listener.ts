import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { NotificationType } from '@prisma/client';
import { DOMAIN_EVENTS, PayoutReleasedPayload } from '../../../common/events/domain-events';
import { TypedEventEmitter } from '../../../common/events/typed-event-emitter.service';
import { NotificationsRepository } from '../notifications.repository';

@Injectable()
export class PayoutReleasedListener implements OnModuleInit {
  private readonly logger = new Logger(PayoutReleasedListener.name);

  constructor(
    private readonly repo: NotificationsRepository,
    private readonly events: TypedEventEmitter,
  ) {}

  onModuleInit(): void {
    this.events.on(DOMAIN_EVENTS.PAYOUT_RELEASED, (payload) => {
      this.onPayoutReleased(payload).catch((err: unknown) => {
        this.logger.error(`[payout.released] listener failed: ${err instanceof Error ? err.message : String(err)}`);
      });
    });
  }

  private async onPayoutReleased(payload: PayoutReleasedPayload): Promise<void> {
    const netRupees = (payload.netAmountPaise / 100).toLocaleString('en-IN', {
      style: 'currency',
      currency: 'INR',
      maximumFractionDigits: 0,
    });

    await this.repo.create({
      ownerId: payload.ownerId,
      propertyId: payload.propertyId,
      type: NotificationType.payout_released,
      title: `Payout released — ${payload.batchRef}`,
      body: `${netRupees} has been credited to your bank account.`,
      actionUrl: '/owner/payouts',
    });
  }
}

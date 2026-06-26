import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { DisputesService } from './disputes.service';

/**
 * M6 spec §4: every 5 minutes, auto-close disputes whose 7-day resolution
 * deadline has passed with no admin resolution (guest-favour full refund).
 */
@Injectable()
export class DisputeLifecycleScheduler {
  private readonly logger = new Logger(DisputeLifecycleScheduler.name);

  constructor(private readonly disputes: DisputesService) {}

  @Cron(CronExpression.EVERY_5_MINUTES)
  async handleAutoClose(): Promise<void> {
    const count = await this.disputes.runAutoClose();
    if (count > 0) this.logger.log(`Auto-closed ${count} dispute(s) past their resolution deadline.`);
  }
}

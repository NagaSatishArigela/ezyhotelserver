import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { PayoutsService } from './payouts.service';

@Injectable()
export class PayoutsLifecycleScheduler {
  private readonly logger = new Logger(PayoutsLifecycleScheduler.name);

  constructor(private readonly payouts: PayoutsService) {}

  // Every Monday at 02:00 IST (UTC+5:30) = Sunday 20:30 UTC = '30 20 * * 0'
  @Cron('30 20 * * 0')
  async handleWeeklyBatch(): Promise<void> {
    const now = new Date();
    // Cycle: prior Monday 00:00 UTC → prior Sunday 23:59:59 UTC
    const dayMs = 24 * 60 * 60 * 1000;
    const priorMonday = new Date(now.getTime() - 7 * dayMs);
    priorMonday.setUTCHours(0, 0, 0, 0);
    const priorSunday = new Date(priorMonday.getTime() + 7 * dayMs - 1);

    this.logger.log(`Generating weekly payout batch for ${priorMonday.toISOString()} → ${priorSunday.toISOString()}`);

    const result = await this.payouts.generateBatch({
      cycleStartAt: priorMonday.toISOString(),
      cycleEndAt: priorSunday.toISOString(),
    });

    this.logger.log(`Batch ${result.batchRef} created — ${result.itemCount} items, net ₹${(result.totalNetPaise / 100).toFixed(2)}`);
  }
}

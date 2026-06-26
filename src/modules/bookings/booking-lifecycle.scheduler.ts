import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { BookingsService } from './bookings.service';

/**
 * M3 spec §5: every 5 minutes, sweep bookings whose lifecycle transitions
 * are time-driven rather than triggered by a guest/owner action.
 */
@Injectable()
export class BookingLifecycleScheduler {
  private readonly logger = new Logger(BookingLifecycleScheduler.name);

  constructor(private readonly bookings: BookingsService) {}

  @Cron(CronExpression.EVERY_5_MINUTES)
  async handleAutoCheckout(): Promise<void> {
    const count = await this.bookings.runAutoCheckout();
    if (count > 0) this.logger.log(`Auto-checked-out ${count} booking(s).`);
  }

  @Cron(CronExpression.EVERY_5_MINUTES)
  async handleNoShowDetection(): Promise<void> {
    const count = await this.bookings.runNoShowDetection();
    if (count > 0) this.logger.log(`Marked ${count} booking(s) as no-show.`);
  }

  @Cron(CronExpression.EVERY_5_MINUTES)
  async handlePaymentTimeouts(): Promise<void> {
    const count = await this.bookings.runPaymentTimeouts();
    if (count > 0) this.logger.log(`Cancelled ${count} booking(s) for payment timeout.`);
  }
}

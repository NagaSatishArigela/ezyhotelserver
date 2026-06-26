import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { ReviewsService } from './reviews.service';

@Injectable()
export class ReviewsLifecycleScheduler {
  private readonly logger = new Logger(ReviewsLifecycleScheduler.name);

  constructor(private readonly reviews: ReviewsService) {}

  @Cron(CronExpression.EVERY_5_MINUTES)
  async handleOpenWindows(): Promise<void> {
    const count = await this.reviews.openReviewWindows();
    if (count > 0) this.logger.log(`Opened review windows for ${count} booking(s).`);
  }

  @Cron(CronExpression.EVERY_5_MINUTES)
  async handleSendPrompts(): Promise<void> {
    const count = await this.reviews.sendReviewPrompts();
    if (count > 0) this.logger.log(`Sent review prompts for ${count} review(s).`);
  }

  @Cron('0 */30 * * * *')
  async handleExpireReviews(): Promise<void> {
    const count = await this.reviews.expireReviews();
    if (count > 0) this.logger.log(`Expired ${count} unsubmitted review(s).`);
  }

  @Cron(CronExpression.EVERY_HOUR)
  async handleReplyReminders(): Promise<void> {
    const count = await this.reviews.sendReplyReminders();
    if (count > 0) this.logger.log(`Sent reply reminders for ${count} review(s).`);
  }
}

import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { BookingsModule } from '../bookings/bookings.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { AdminReviewsController } from './admin-reviews.controller';
import { OwnerReviewsController } from './owner-reviews.controller';
import { ReviewsController } from './reviews.controller';
import { ReviewsLifecycleScheduler } from './reviews-lifecycle.scheduler';
import { ReviewsRepository } from './reviews.repository';
import { ReviewsService } from './reviews.service';

@Module({
  imports: [AuthModule, BookingsModule, NotificationsModule],
  controllers: [ReviewsController, OwnerReviewsController, AdminReviewsController],
  providers: [ReviewsService, ReviewsRepository, ReviewsLifecycleScheduler],
  exports: [ReviewsService],
})
export class ReviewsModule {}

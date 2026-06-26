import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { BookingStatusListener } from './listeners/booking-status.listener';
import { PayoutReleasedListener } from './listeners/payout-released.listener';
import { PropertyStatusListener } from './listeners/property-status.listener';
import { ReviewEventsListener } from './listeners/review-events.listener';
import { NotificationsController } from './notifications.controller';
import { NotificationsRepository } from './notifications.repository';
import { NotificationsService } from './notifications.service';
import { NotificationDeliveryService } from './services/notification-delivery.service';

@Module({
  imports: [AuthModule],
  controllers: [NotificationsController],
  providers: [
    NotificationsService,
    NotificationsRepository,
    PropertyStatusListener,
    BookingStatusListener,
    PayoutReleasedListener,
    ReviewEventsListener,
    NotificationDeliveryService,
  ],
  exports: [NotificationsRepository],
})
export class NotificationsModule {}

import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { BookingsModule } from '../bookings/bookings.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { AdminDisputesController } from './admin-disputes.controller';
import { DisputeLifecycleScheduler } from './dispute-lifecycle.scheduler';
import { DisputesController } from './disputes.controller';
import { DisputesRepository } from './disputes.repository';
import { DisputesService } from './disputes.service';
import { OwnerDisputesController } from './owner-disputes.controller';

@Module({
  imports: [AuthModule, BookingsModule, NotificationsModule],
  controllers: [DisputesController, AdminDisputesController, OwnerDisputesController],
  providers: [DisputesService, DisputesRepository, DisputeLifecycleScheduler],
})
export class DisputesModule {}

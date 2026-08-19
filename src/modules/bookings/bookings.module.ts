import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { AdminAnomaliesController } from './admin/admin-anomalies.controller';
import { AdminAnomaliesService } from './admin/admin-anomalies.service';
import { AdminBookingsController } from './admin/admin-bookings.controller';
import { AdminBookingsRepository } from './admin/admin-bookings.repository';
import { AdminBookingsService } from './admin/admin-bookings.service';
import { AnomaliesRepository } from './admin/anomalies.repository';
import { AnomalyDetectionScheduler } from './admin/anomaly-detection.scheduler';
import { AvailabilityController } from './availability.controller';
import { BookingLifecycleScheduler } from './booking-lifecycle.scheduler';
import { BookingsController } from './bookings.controller';
import { BookingsRepository } from './bookings.repository';
import { BookingsService } from './bookings.service';
import { MyBookingsController } from './my-bookings.controller';
import { OwnerBookingsController } from './owner-bookings.controller';
import { PaymentsService } from './payments.service';

@Module({
  imports: [AuthModule],
  controllers: [
    AvailabilityController,
    BookingsController,
    MyBookingsController,
    OwnerBookingsController,
    AdminBookingsController,
    AdminAnomaliesController,
  ],
  providers: [
    BookingsService,
    PaymentsService,
    BookingsRepository,
    BookingLifecycleScheduler,
    AdminBookingsService,
    AdminBookingsRepository,
    AdminAnomaliesService,
    AnomaliesRepository,
    AnomalyDetectionScheduler,
  ],
  exports: [BookingsRepository],
})
export class BookingsModule {}

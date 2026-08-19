import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ScheduleModule } from '@nestjs/schedule';
import { ThrottlerModule } from '@nestjs/throttler';
import { TestAwareThrottlerGuard } from './common/guards/test-aware-throttler.guard';
import { EventEmitterModule } from '@nestjs/event-emitter';
import { APP_GUARD } from '@nestjs/core';
import { AuthModule } from './modules/auth/auth.module';
import { DatabaseModule } from './modules/database/database.module';
import { RedisModule } from './modules/redis/redis.module';
import { EventsModule } from './common/events/events.module';
import { CryptoModule } from './common/crypto/crypto.module';
import { PropertiesModule } from './modules/properties/properties.module';
import { NotificationsModule } from './modules/notifications/notifications.module';
import { BookingsModule } from './modules/bookings/bookings.module';
import { DisputesModule } from './modules/disputes/disputes.module';
import { ReviewsModule } from './modules/reviews/reviews.module';
import { PayoutsModule } from './modules/payouts/payouts.module';
import { SuperAdminModule } from './modules/super-admin/super-admin.module';
import { SupportModule } from './modules/support/support.module';
import { UploadsModule } from './modules/uploads/uploads.module';
import { PlatformModule } from './modules/platform/platform.module';
import { FinanceModule } from './modules/finance/finance.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: ['.env.local', '.env'],
    }),
    ScheduleModule.forRoot(),
    // The ONLY inter-domain communication mechanism in the modular monolith.
    // Domain modules (properties, bookings, finance, etc.) must publish/
    // subscribe via EventEmitter2 - never inject services from another
    // domain's module directly. This keeps domains independently
    // extractable later (swap EventEmitter2 for SQS/event bus without
    // changing the contracts in src/common/events).
    EventEmitterModule.forRoot({
      wildcard: true,
      delimiter: '.',
      // 50 listeners supports current 17 domain events × ~3 subscribers each
      // with room to grow before the memory-leak warning fires
      maxListeners: 50,
      verboseMemoryLeak: true,
    }),
    // Tiered rate limits (E17): default=100/min for most endpoints; sensitive
    // and expensive endpoints override per-route with @Throttle().
    // Naming convention:
    //  default  — read-heavy public endpoints (search, list)
    //  strict   — state-mutating or security-sensitive endpoints (auth, write)
    //  upload   — file/document upload endpoints (expensive I/O)
    ThrottlerModule.forRoot([
      { name: 'default', ttl: 60_000,    limit: 200 }, // search/list — raised to 200
      { name: 'strict',  ttl: 60_000,    limit: 10  }, // write/auth — controller-level override
      { name: 'upload',  ttl: 3_600_000, limit: 20  }, // file upload — per hour
    ]),
    EventsModule,
    CryptoModule,
    DatabaseModule,
    RedisModule,
    PlatformModule,
    FinanceModule,
    AuthModule,
    PropertiesModule,
    NotificationsModule,
    BookingsModule,
    DisputesModule,
    ReviewsModule,
    PayoutsModule,
    SuperAdminModule,
    SupportModule,
    UploadsModule,
  ],
  providers: [
    {
      provide: APP_GUARD,
      useClass: TestAwareThrottlerGuard,
    },
  ],
})
export class AppModule {}

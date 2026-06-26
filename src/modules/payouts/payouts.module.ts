import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { AdminPayoutsController } from './admin-payouts.controller';
import { PayoutsController } from './payouts.controller';
import { PayoutsLifecycleScheduler } from './payouts-lifecycle.scheduler';
import { PayoutsRepository } from './payouts.repository';
import { PayoutsService } from './payouts.service';

@Module({
  imports: [AuthModule],
  controllers: [PayoutsController, AdminPayoutsController],
  providers: [PayoutsService, PayoutsRepository, PayoutsLifecycleScheduler],
  exports: [PayoutsService],
})
export class PayoutsModule {}

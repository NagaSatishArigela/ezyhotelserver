import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { SupportAgentController, SupportTicketController } from './support.controller';
import { SupportRepository } from './support.repository';
import { SupportService } from './support.service';

@Module({
  imports: [AuthModule],
  controllers: [SupportTicketController, SupportAgentController],
  providers: [SupportService, SupportRepository],
})
export class SupportModule {}

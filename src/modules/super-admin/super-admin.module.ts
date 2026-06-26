import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { SuperAdminController } from './super-admin.controller';
import { SuperAdminRepository } from './super-admin.repository';
import { SuperAdminService } from './super-admin.service';

@Module({
  imports: [AuthModule],
  controllers: [SuperAdminController],
  providers: [SuperAdminService, SuperAdminRepository],
})
export class SuperAdminModule {}

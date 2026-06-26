import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { AdminPropertiesController } from './admin/admin-properties.controller';
import { AdminPropertiesService } from './admin/admin-properties.service';
import { ComplianceRepository } from './compliance/compliance.repository';
import { ComplianceService } from './compliance/compliance.service';
import { PropertiesController } from './properties.controller';
import { PropertiesRepository } from './properties.repository';
import { PropertiesService } from './properties.service';
import { PublicPropertiesController } from './public/public-properties.controller';
import { PublicPropertiesService } from './public/public-properties.service';

@Module({
  imports: [AuthModule],
  controllers: [PropertiesController, AdminPropertiesController, PublicPropertiesController],
  providers: [
    PropertiesService,
    PropertiesRepository,
    ComplianceService,
    ComplianceRepository,
    AdminPropertiesService,
    PublicPropertiesService,
  ],
  exports: [PropertiesService, PropertiesRepository, ComplianceService],
})
export class PropertiesModule {}

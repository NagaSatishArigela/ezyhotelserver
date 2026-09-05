import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { UploadsController } from './uploads.controller';
import { StorageService } from './storage.service';

@Module({
  imports: [AuthModule],
  controllers: [UploadsController],
  providers: [StorageService],
})
export class UploadsModule {}

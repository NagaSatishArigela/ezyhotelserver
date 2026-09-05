import { Body, Controller, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { PropertyRole } from '@prisma/client';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { PropertyRoles } from '../auth/decorators/property-roles.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { PropertyRoleGuard } from '../auth/guards/property-role.guard';
import { JwtPayload } from '../auth/interfaces/jwt-payload.interface';
import { PresignUploadDto } from './dto/presign-upload.dto';
import { PresignedUpload, StorageService } from './storage.service';

@ApiTags('Uploads')
@ApiBearerAuth()
@Controller('uploads')
@UseGuards(JwtAuthGuard, PropertyRoleGuard)
@PropertyRoles(PropertyRole.OWNER)
export class UploadsController {
  constructor(private readonly storage: StorageService) {}

  @ApiOperation({ summary: 'Create a presigned S3 upload URL for a hotel image or verification document' })
  @Post('presign')
  presign(
    @CurrentUser() _user: JwtPayload,
    @Body() dto: PresignUploadDto,
  ): Promise<PresignedUpload> {
    return this.storage.presignPut(dto);
  }
}

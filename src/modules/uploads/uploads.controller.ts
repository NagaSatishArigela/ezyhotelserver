import { Body, Controller, Get, Header, Param, ParseUUIDPipe, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { ApplicationAccess } from '../auth/property-permissions';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { PropertyRoleGuard } from '../auth/guards/property-role.guard';
import { JwtPayload } from '../auth/interfaces/jwt-payload.interface';
import { PresignUploadDto } from './dto/presign-upload.dto';
import { PresignedUpload, StorageService } from './storage.service';

@ApiTags('Uploads')
@ApiBearerAuth()
@Controller('uploads')
@UseGuards(JwtAuthGuard, PropertyRoleGuard)
@ApplicationAccess()
export class UploadsController {
  constructor(private readonly storage: StorageService) {}

  @Get('documents/:propertyId/:file')
  @Header('Cache-Control', 'private, no-store')
  readDocument(@Param('propertyId', ParseUUIDPipe) propertyId: string, @Param('file') file: string) {
    return this.storage.readDocument(propertyId, file);
  }

  @ApiOperation({ summary: 'Create a presigned S3 upload URL for a hotel image or verification document' })
  @Post('presign')
  presign(
    @CurrentUser() _user: JwtPayload,
    @Body() dto: PresignUploadDto,
  ): Promise<PresignedUpload> {
    return this.storage.presignPut(dto);
  }
}

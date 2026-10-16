import { Body, Controller, Get, Header, Param, ParseUUIDPipe, Post, Put, Req, StreamableFile, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { SkipThrottle, Throttle } from '@nestjs/throttler';
import { PropertyRole } from '@prisma/client';
import { Request } from 'express';
import { PropertyRoles } from '../auth/decorators/property-roles.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { PropertyRoleGuard } from '../auth/guards/property-role.guard';
import { PresignUploadDto } from './presign-upload.dto';
import { UploadsService } from './uploads.service';

@ApiTags('Uploads')
@Controller('uploads')
export class UploadsController {
  constructor(private readonly uploads: UploadsService) {}

  @Post('presign')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Authorize a property photo or document upload' })
  @UseGuards(JwtAuthGuard, PropertyRoleGuard)
  @PropertyRoles(PropertyRole.OWNER)
  @SkipThrottle({ strict: true })
  @Throttle({ upload: { limit: 20, ttl: 3600000 } })
  presign(@Body() dto: PresignUploadDto) {
    return this.uploads.presign(dto);
  }

  @Get(':propertyId/document/:fileName')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Read a verification document as its owner or an administrator' })
  @UseGuards(JwtAuthGuard, PropertyRoleGuard)
  @PropertyRoles(PropertyRole.OWNER)
  @SkipThrottle({ strict: true })
  @Header('Cache-Control', 'no-store')
  async document(@Param('propertyId', ParseUUIDPipe) propertyId: string, @Param('fileName') fileName: string) {
    const { file, contentType } = await this.uploads.document(propertyId, fileName);
    return new StreamableFile(file, { type: contentType, disposition: `inline; filename="${fileName}"` });
  }

  @Put('put/:token')
  @ApiOperation({ summary: 'Upload the raw file using the short-lived upload grant' })
  @SkipThrottle({ strict: true })
  put(@Param('token') token: string, @Req() request: Request) {
    return this.uploads.store(token, request.header('content-type'), request);
  }
}

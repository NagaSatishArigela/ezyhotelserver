import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { GlobalRole } from '@prisma/client';
import { CurrentUser } from '../../auth/decorators/current-user.decorator';
import { Roles } from '../../auth/decorators/roles.decorator';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../../auth/guards/roles.guard';
import { JwtPayload } from '../../auth/interfaces/jwt-payload.interface';
import {
  AdminPropertiesService,
  AdminPropertyDetail,
  ModerationResult,
  PropertyQueueResult,
} from './admin-properties.service';
import { ListPropertiesQueryDto } from './dto/list-properties-query.dto';
import { RejectPropertyDto } from './dto/reject-property.dto';
import { RequestRevisionDto } from './dto/request-revision.dto';

@ApiTags('Admin / Properties')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(GlobalRole.ADMIN, GlobalRole.SUPER_ADMIN)
@Controller('admin/properties')
export class AdminPropertiesController {
  constructor(private readonly adminProperties: AdminPropertiesService) {}

  @ApiOperation({ summary: 'List properties in the moderation queue' })
  @Get()
  list(@Query() query: ListPropertiesQueryDto): Promise<PropertyQueueResult> {
    return this.adminProperties.listQueue(query.status, query.page, query.limit);
  }

  @ApiOperation({ summary: 'Get full property detail for moderation' })
  @Get(':propertyId')
  getDetail(
    @Param('propertyId', ParseUUIDPipe) propertyId: string,
  ): Promise<AdminPropertyDetail> {
    return this.adminProperties.getDetail(propertyId);
  }

  @ApiOperation({ summary: 'Approve a pending property submission' })
  @Post(':propertyId/approve')
  approve(
    @Param('propertyId', ParseUUIDPipe) propertyId: string,
    @CurrentUser() user: JwtPayload,
  ): Promise<ModerationResult> {
    return this.adminProperties.approve(propertyId, user.id);
  }

  @ApiOperation({ summary: 'Reject a pending property submission' })
  @Post(':propertyId/reject')
  reject(
    @Param('propertyId', ParseUUIDPipe) propertyId: string,
    @CurrentUser() user: JwtPayload,
    @Body() body: RejectPropertyDto,
  ): Promise<ModerationResult> {
    return this.adminProperties.reject(propertyId, user.id, body.reason);
  }

  @ApiOperation({ summary: 'Request changes to a pending property submission' })
  @Post(':propertyId/request-revision')
  requestRevision(
    @Param('propertyId', ParseUUIDPipe) propertyId: string,
    @CurrentUser() user: JwtPayload,
    @Body() body: RequestRevisionDto,
  ): Promise<ModerationResult> {
    return this.adminProperties.requestRevision(propertyId, user.id, body.items);
  }
}

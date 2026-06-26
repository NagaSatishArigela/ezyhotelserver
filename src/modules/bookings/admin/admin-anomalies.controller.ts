import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Anomaly, GlobalRole } from '@prisma/client';
import { CurrentUser } from '../../auth/decorators/current-user.decorator';
import { Roles } from '../../auth/decorators/roles.decorator';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../../auth/guards/roles.guard';
import { JwtPayload } from '../../auth/interfaces/jwt-payload.interface';
import {
  AdminAnomalyDetail,
  AdminAnomalyListResult,
  AdminAnomaliesService,
} from './admin-anomalies.service';
import { ListAdminAnomaliesQueryDto } from './dto/list-admin-anomalies-query.dto';
import { UpdateAnomalyStatusDto } from './dto/update-anomaly-status.dto';

@ApiTags('Admin / Anomalies')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(GlobalRole.ADMIN, GlobalRole.SUPER_ADMIN)
@Controller('admin/anomalies')
export class AdminAnomaliesController {
  constructor(private readonly adminAnomalies: AdminAnomaliesService) {}

  @ApiOperation({ summary: 'List anomalies with admin filters' })
  @Get()
  list(@Query() query: ListAdminAnomaliesQueryDto): Promise<AdminAnomalyListResult> {
    return this.adminAnomalies.list(query);
  }

  @ApiOperation({ summary: 'Count of unresolved anomalies (for tab badge)' })
  @Get('unresolved-count')
  unresolvedCount(): Promise<{ count: number }> {
    return this.adminAnomalies.unresolvedCount();
  }

  @ApiOperation({ summary: 'Anomaly detail incl. evidence and related actions' })
  @Get(':id')
  getDetail(@Param('id', ParseUUIDPipe) id: string): Promise<AdminAnomalyDetail> {
    return this.adminAnomalies.getDetail(id);
  }

  @ApiOperation({ summary: 'Update anomaly status (investigate / resolve / escalate)' })
  @Patch(':id')
  updateStatus(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: JwtPayload,
    @Body() body: UpdateAnomalyStatusDto,
  ): Promise<Anomaly> {
    return this.adminAnomalies.updateStatus(id, user.id, body);
  }
}

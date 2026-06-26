import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Dispute, GlobalRole } from '@prisma/client';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { JwtPayload } from '../auth/interfaces/jwt-payload.interface';
import {
  AdminDisputeDetail,
  AdminDisputeListResult,
  DisputesService,
} from './disputes.service';
import { ListAdminDisputesQueryDto } from './dto/list-admin-disputes-query.dto';
import { ResolveDisputeDto } from './dto/resolve-dispute.dto';

@ApiTags('Admin / Disputes')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(GlobalRole.ADMIN, GlobalRole.SUPER_ADMIN)
@Controller('admin/disputes')
export class AdminDisputesController {
  constructor(private readonly disputes: DisputesService) {}

  @ApiOperation({ summary: 'List disputes with admin filters' })
  @Get()
  list(@Query() query: ListAdminDisputesQueryDto): Promise<AdminDisputeListResult> {
    return this.disputes.list(query);
  }

  @ApiOperation({ summary: 'Count of unresolved disputes (Disputes tab badge)' })
  @Get('unresolved-count')
  unresolvedCount(): Promise<{ count: number }> {
    return this.disputes.unresolvedCount();
  }

  @ApiOperation({ summary: 'Full dispute detail incl. booking/guest/property context' })
  @Get(':id')
  getDetail(@Param('id', ParseUUIDPipe) id: string): Promise<AdminDisputeDetail> {
    return this.disputes.getDetail(id);
  }

  @ApiOperation({ summary: "Open the 48h hotel-response window for a dispute" })
  @Post(':id/request-response')
  requestResponse(@Param('id', ParseUUIDPipe) id: string): Promise<Dispute> {
    return this.disputes.requestResponse(id);
  }

  @ApiOperation({ summary: 'Resolve a dispute (full/partial refund, no action, wallet credit, or escalate)' })
  @Patch(':id/resolve')
  resolve(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: JwtPayload,
    @Body() dto: ResolveDisputeDto,
  ): Promise<Dispute> {
    return this.disputes.resolve(id, user.id, dto);
  }
}

import { Controller, Get, Param, ParseUUIDPipe, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { PropertyRole } from '@prisma/client';
import { PropertyRoles } from '../auth/decorators/property-roles.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { PropertyRoleGuard } from '../auth/guards/property-role.guard';
import { DisputesService, OwnerDisputeListResult } from './disputes.service';
import { ListOwnerDisputesQueryDto } from './dto/list-owner-disputes-query.dto';

@ApiTags('Disputes')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PropertyRoleGuard)
@Controller('owner/properties')
export class OwnerDisputesController {
  constructor(private readonly disputes: DisputesService) {}

  @ApiOperation({ summary: "Read-only list of a property's disputes" })
  @PropertyRoles(PropertyRole.OWNER, PropertyRole.MANAGER)
  @Get(':propertyId/disputes')
  list(
    @Param('propertyId', ParseUUIDPipe) propertyId: string,
    @Query() query: ListOwnerDisputesQueryDto,
  ): Promise<OwnerDisputeListResult> {
    return this.disputes.listForOwner(propertyId, query.page, query.limit);
  }
}

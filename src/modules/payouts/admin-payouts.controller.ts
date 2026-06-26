import { Body, Controller, Get, HttpCode, HttpStatus, Param, ParseUUIDPipe, Post, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { GlobalRole } from '@prisma/client';
import { Roles } from '../auth/decorators/roles.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { GenerateBatchDto } from './dto/generate-batch.dto';
import { HoldItemDto } from './dto/hold-item.dto';
import { ListAdminPayoutsQueryDto } from './dto/list-payouts-query.dto';
import { PayoutsService } from './payouts.service';

@ApiTags('Admin / Payouts')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(GlobalRole.ADMIN, GlobalRole.SUPER_ADMIN)
@Controller('admin/payouts')
export class AdminPayoutsController {
  constructor(private readonly payouts: PayoutsService) {}

  @ApiOperation({ summary: 'KPI summary strip' })
  @Get('summary')
  summary() {
    return this.payouts.adminSummary();
  }

  @ApiOperation({ summary: 'List all payout batches (filterable by status)' })
  @Get()
  list(@Query() query: ListAdminPayoutsQueryDto) {
    return this.payouts.adminListBatches(query);
  }

  @ApiOperation({ summary: 'Batch detail with all payout items' })
  @Get(':batchId')
  detail(@Param('batchId', ParseUUIDPipe) batchId: string) {
    return this.payouts.adminBatchDetail(batchId);
  }

  @ApiOperation({ summary: 'Manually generate a payout batch for a date range' })
  @Post('generate')
  generate(@Body() dto: GenerateBatchDto) {
    return this.payouts.generateBatch(dto);
  }

  @ApiOperation({ summary: 'Release all pending items in a batch' })
  @Post(':batchId/release')
  @HttpCode(HttpStatus.OK)
  releaseBatch(@Param('batchId', ParseUUIDPipe) batchId: string) {
    return this.payouts.releaseBatch(batchId);
  }

  @ApiOperation({ summary: 'Put a single payout item on hold' })
  @Post('items/:itemId/hold')
  @HttpCode(HttpStatus.OK)
  holdItem(@Param('itemId', ParseUUIDPipe) itemId: string, @Body() dto: HoldItemDto) {
    return this.payouts.holdItem(itemId, dto.reason);
  }

  @ApiOperation({ summary: 'Release a single held payout item' })
  @Post('items/:itemId/release')
  @HttpCode(HttpStatus.OK)
  releaseItem(@Param('itemId', ParseUUIDPipe) itemId: string) {
    return this.payouts.releaseItem(itemId);
  }
}

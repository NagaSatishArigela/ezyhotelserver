import { Controller, Get, Param, ParseUUIDPipe, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { JwtPayload } from '../auth/interfaces/jwt-payload.interface';
import { ListPayoutsQueryDto } from './dto/list-payouts-query.dto';
import { PayoutsService } from './payouts.service';

@ApiTags('Owner / Payouts')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('owner/payouts')
export class PayoutsController {
  constructor(private readonly payouts: PayoutsService) {}

  @ApiOperation({ summary: 'List payout history for the authenticated owner' })
  @Get()
  list(@CurrentUser() user: JwtPayload, @Query() query: ListPayoutsQueryDto) {
    return this.payouts.ownerListPayouts(user.id, query);
  }

  @ApiOperation({ summary: 'Payout batch detail with booking breakdown' })
  @Get(':batchId')
  detail(@Param('batchId', ParseUUIDPipe) batchId: string, @CurrentUser() user: JwtPayload) {
    return this.payouts.ownerPayoutDetail(batchId, user.id);
  }
}

import { Body, Controller, Param, ParseUUIDPipe, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Dispute } from '@prisma/client';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { JwtPayload } from '../auth/interfaces/jwt-payload.interface';
import { DisputesService } from './disputes.service';
import { CreateDisputeDto } from './dto/create-dispute.dto';
import { HotelResponseDto } from './dto/hotel-response.dto';

@ApiTags('Disputes')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller()
export class DisputesController {
  constructor(private readonly disputes: DisputesService) {}

  @ApiOperation({ summary: 'File a dispute for a completed booking (within 48h of checkout)' })
  @Post('bookings/:id/disputes')
  fileDispute(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: JwtPayload,
    @Body() dto: CreateDisputeDto,
  ): Promise<Dispute> {
    return this.disputes.fileDispute(id, user.id, dto);
  }

  @ApiOperation({ summary: "Hotel owner/manager submits a response to a dispute against their property" })
  @Post('disputes/:id/hotel-response')
  submitHotelResponse(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: JwtPayload,
    @Body() dto: HotelResponseDto,
  ): Promise<Dispute> {
    return this.disputes.submitHotelResponse(id, user.id, dto);
  }
}

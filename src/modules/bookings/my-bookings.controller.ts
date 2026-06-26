import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { JwtPayload } from '../auth/interfaces/jwt-payload.interface';
import { BookingsService } from './bookings.service';
import { ListBookingsQueryDto } from './dto/list-bookings-query.dto';

@ApiTags('Bookings')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('me/bookings')
export class MyBookingsController {
  constructor(private readonly bookings: BookingsService) {}

  @ApiOperation({ summary: "List the current guest's bookings" })
  @Get()
  list(@CurrentUser() user: JwtPayload, @Query() query: ListBookingsQueryDto) {
    return this.bookings.listMyBookings(user.id, query.status, query.page, query.limit);
  }
}

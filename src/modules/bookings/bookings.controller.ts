import { Body, Controller, Get, Param, ParseUUIDPipe, Post, UseGuards } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { JwtPayload } from '../auth/interfaces/jwt-payload.interface';
import { BookingsService } from './bookings.service';
import { CancelBookingDto } from './dto/cancel-booking.dto';
import { CheckInDto } from './dto/check-in.dto';
import { CreateBookingDto } from './dto/create-booking.dto';
import { PaymentConfirmDto } from './dto/payment-confirm.dto';

@ApiTags('Bookings')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('bookings')
export class BookingsController {
  constructor(private readonly bookings: BookingsService) {}

  @ApiOperation({ summary: 'Create a new booking (pending_payment)' })
  @Throttle({ strict: { limit: 10, ttl: 60_000 } })
  @Post()
  create(@CurrentUser() user: JwtPayload, @Body() dto: CreateBookingDto) {
    return this.bookings.createBooking(user.id, dto);
  }

  @ApiOperation({ summary: 'Get full booking detail' })
  @Get(':id')
  get(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: JwtPayload) {
    return this.bookings.getBooking(id, user);
  }

  @ApiOperation({ summary: 'Mock payment gateway confirmation' })
  @Post(':id/payment/confirm')
  confirmPayment(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: JwtPayload,
    @Body() dto: PaymentConfirmDto,
  ) {
    return this.bookings.confirmPayment(id, user.id, dto);
  }

  @ApiOperation({ summary: 'Check in using the booking QR code' })
  @Post(':id/check-in')
  checkIn(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: JwtPayload,
    @Body() dto: CheckInDto,
  ) {
    return this.bookings.checkIn(id, dto, user.id);
  }

  @ApiOperation({ summary: 'Manually check out a booking' })
  @Post(':id/check-out')
  checkOut(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: JwtPayload) {
    return this.bookings.checkOut(id, user.id);
  }

  @ApiOperation({ summary: 'Cancel a confirmed booking' })
  @Post(':id/cancel')
  cancel(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: JwtPayload, @Body() dto: CancelBookingDto) {
    return this.bookings.cancel(id, user.id, dto);
  }
}

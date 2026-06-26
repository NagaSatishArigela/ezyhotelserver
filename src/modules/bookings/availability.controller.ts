import { Controller, Get, Param, ParseUUIDPipe, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { BookingsService } from './bookings.service';
import { AvailabilityQueryDto } from './dto/availability-query.dto';

@ApiTags('Bookings')
@Controller('properties')
export class AvailabilityController {
  constructor(private readonly bookings: BookingsService) {}

  @ApiOperation({ summary: 'Get booked intervals for a room type on a given date' })
  @Get(':propertyId/availability')
  getAvailability(
    @Param('propertyId', ParseUUIDPipe) propertyId: string,
    @Query() query: AvailabilityQueryDto,
  ) {
    return this.bookings.getAvailability(propertyId, query.roomTypeId, query.date);
  }
}

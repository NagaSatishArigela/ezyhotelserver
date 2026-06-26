import { Controller, Get, Param, ParseUUIDPipe, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { PropertyRole } from '@prisma/client';
import { PropertyRoles } from '../auth/decorators/property-roles.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { PropertyRoleGuard } from '../auth/guards/property-role.guard';
import { BookingsService } from './bookings.service';
import { ListBookingsQueryDto } from './dto/list-bookings-query.dto';

@ApiTags('Bookings')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PropertyRoleGuard)
@Controller('owner/properties')
export class OwnerBookingsController {
  constructor(private readonly bookings: BookingsService) {}

  @ApiOperation({ summary: "Read-only list of a property's bookings" })
  @PropertyRoles(PropertyRole.OWNER)
  @Get(':propertyId/bookings')
  list(@Param('propertyId', ParseUUIDPipe) propertyId: string, @Query() query: ListBookingsQueryDto) {
    return this.bookings.listPropertyBookings(propertyId, query.page, query.limit);
  }
}

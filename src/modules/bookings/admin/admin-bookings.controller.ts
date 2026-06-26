import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Booking, GlobalRole } from '@prisma/client';
import { CurrentUser } from '../../auth/decorators/current-user.decorator';
import { Roles } from '../../auth/decorators/roles.decorator';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../../auth/guards/roles.guard';
import { JwtPayload } from '../../auth/interfaces/jwt-payload.interface';
import {
  AdminActiveBookingItem,
  AdminBookingDetail,
  AdminBookingKpis,
  AdminBookingListResult,
  AdminBookingsService,
} from './admin-bookings.service';
import {
  AdminCancelBookingDto,
  ExtendBookingDto,
  FlagBookingDto,
  ForceCheckoutBookingDto,
  RefundBookingDto,
  VoidBookingDto,
} from './dto/admin-booking-actions.dto';
import {
  AdminBookingKpisQueryDto,
  ListAdminBookingsQueryDto,
} from './dto/list-admin-bookings-query.dto';

@ApiTags('Admin / Bookings')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(GlobalRole.ADMIN, GlobalRole.SUPER_ADMIN)
@Controller('admin/bookings')
export class AdminBookingsController {
  constructor(private readonly adminBookings: AdminBookingsService) {}

  @ApiOperation({ summary: 'List bookings with admin filters' })
  @Get()
  list(@Query() query: ListAdminBookingsQueryDto): Promise<AdminBookingListResult> {
    return this.adminBookings.list(query);
  }

  @ApiOperation({ summary: 'KPI summary for the active filter set' })
  @Get('kpis')
  kpis(@Query() query: AdminBookingKpisQueryDto): Promise<AdminBookingKpis> {
    return this.adminBookings.kpis(query);
  }

  @ApiOperation({ summary: 'Currently checked-in bookings, soonest-expiring first' })
  @Get('active')
  active(): Promise<AdminActiveBookingItem[]> {
    return this.adminBookings.active();
  }

  @ApiOperation({ summary: 'Full booking detail incl. timeline and admin actions' })
  @Get(':id')
  getDetail(@Param('id', ParseUUIDPipe) id: string): Promise<AdminBookingDetail> {
    return this.adminBookings.getDetail(id);
  }

  @ApiOperation({ summary: 'Void a booking (fraud/error, auto-refunds 100%)' })
  @Post(':id/void')
  void(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: JwtPayload,
    @Body() body: VoidBookingDto,
  ): Promise<Booking> {
    return this.adminBookings.void(id, user.id, body);
  }

  @ApiOperation({ summary: 'Admin-initiated cancellation' })
  @Post(':id/cancel')
  cancel(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: JwtPayload,
    @Body() body: AdminCancelBookingDto,
  ): Promise<Booking> {
    return this.adminBookings.cancel(id, user.id, body);
  }

  @ApiOperation({ summary: 'Issue a full or partial refund' })
  @Post(':id/refund')
  refund(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: JwtPayload,
    @Body() body: RefundBookingDto,
  ): Promise<Booking> {
    return this.adminBookings.refund(id, user.id, body);
  }

  @ApiOperation({ summary: 'Force-checkout a checked-in guest' })
  @Post(':id/force-checkout')
  forceCheckout(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: JwtPayload,
    @Body() body: ForceCheckoutBookingDto,
  ): Promise<Booking> {
    return this.adminBookings.forceCheckout(id, user.id, body);
  }

  @ApiOperation({ summary: 'Extend a checked-in booking checkout time' })
  @Post(':id/extend')
  extend(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: JwtPayload,
    @Body() body: ExtendBookingDto,
  ): Promise<Booking> {
    return this.adminBookings.extend(id, user.id, body);
  }

  @ApiOperation({ summary: 'Flag a booking for review' })
  @Post(':id/flag')
  flag(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: JwtPayload,
    @Body() body: FlagBookingDto,
  ): Promise<Booking> {
    return this.adminBookings.flag(id, user.id, body);
  }

  @ApiOperation({ summary: 'Remove a flag from a booking' })
  @Post(':id/unflag')
  unflag(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: JwtPayload): Promise<Booking> {
    return this.adminBookings.unflag(id, user.id);
  }
}

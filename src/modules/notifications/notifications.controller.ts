import { Controller, Get, HttpCode, HttpStatus, Param, ParseUUIDPipe, Patch, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Notification } from '@prisma/client';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { JwtPayload } from '../auth/interfaces/jwt-payload.interface';
import { ListNotificationsQueryDto } from './dto/list-notifications-query.dto';
import { NotificationListResult, NotificationsService } from './notifications.service';

@ApiTags('Owner Notifications')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('owners/me/notifications')
export class NotificationsController {
  constructor(private readonly notifications: NotificationsService) {}

  @ApiOperation({ summary: 'Unread notification count for bell badge' })
  @Get('unread-count')
  unreadCount(@CurrentUser() user: JwtPayload): Promise<{ count: number }> {
    return this.notifications.unreadCount(user.id);
  }

  @ApiOperation({ summary: "Get the caller's notification inbox" })
  @Get()
  list(
    @CurrentUser() user: JwtPayload,
    @Query() query: ListNotificationsQueryDto,
  ): Promise<NotificationListResult> {
    return this.notifications.list(user.id, query.unread, query.page, query.limit);
  }

  @ApiOperation({ summary: 'Mark all unread notifications as read' })
  @Patch('read-all')
  @HttpCode(HttpStatus.OK)
  markAllRead(@CurrentUser() user: JwtPayload): Promise<{ updated: number }> {
    return this.notifications.markAllRead(user.id);
  }

  @ApiOperation({ summary: 'Mark a notification as read' })
  @Patch(':id/read')
  markRead(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: JwtPayload,
  ): Promise<Notification> {
    return this.notifications.markRead(id, user.id);
  }
}

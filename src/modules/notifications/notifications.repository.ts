import { DOMAIN_EVENTS } from '../../common/events/domain-events';
import { TypedEventEmitter } from '../../common/events/typed-event-emitter.service';
import { Injectable } from '@nestjs/common';
import { Notification, Prisma } from '@prisma/client';
import { PrismaService } from '../database/prisma.service';

@Injectable()
export class NotificationsRepository {
  constructor(private readonly prisma: PrismaService, private readonly events: TypedEventEmitter) {}

  async create(data: Prisma.NotificationCreateInput): Promise<Notification> {
    const notification = await this.prisma.notification.create({ data });
    // Approval/revision already have dedicated SMS templates in PropertyStatusListener.
    if (notification.propertyId && !['approval', 'revision_request'].includes(notification.type)) {
      this.events.emit(DOMAIN_EVENTS.NOTIFICATION_REQUESTED, {
        channel: 'sms', templateId: 'property_notification', recipientUserId: notification.ownerId,
        data: { propertyId: notification.propertyId, title: notification.title, body: notification.body },
      });
    }
    return notification;
  }

  async receptionMobile(propertyId: string, ownerId: string): Promise<string | null> {
    const property = await this.prisma.property.findFirst({ where: { id: propertyId, ownerId }, select: { receptionMobile: true } });
    return property?.receptionMobile ?? null;
  }

  async findManyByOwner(
    ownerId: string,
    unreadOnly: boolean,
    skip: number,
    take: number,
  ): Promise<{ items: Notification[]; total: number; unreadCount: number }> {
    const where: Prisma.NotificationWhereInput = {
      ownerId,
      ...(unreadOnly ? { isRead: false } : {}),
    };

    const [items, total, unreadCount] = await this.prisma.$transaction([
      this.prisma.notification.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip,
        take,
      }),
      this.prisma.notification.count({ where }),
      this.prisma.notification.count({ where: { ownerId, isRead: false } }),
    ]);

    return { items, total, unreadCount };
  }

  findById(id: string): Promise<Notification | null> {
    return this.prisma.notification.findUnique({ where: { id } });
  }

  markRead(id: string): Promise<Notification> {
    return this.prisma.notification.update({
      where: { id },
      data: { isRead: true },
    });
  }

  unreadCount(ownerId: string): Promise<number> {
    return this.prisma.notification.count({ where: { ownerId, isRead: false } });
  }

  async markAllRead(ownerId: string): Promise<number> {
    const result = await this.prisma.notification.updateMany({
      where: { ownerId, isRead: false },
      data: { isRead: true },
    });
    return result.count;
  }
}

import { Injectable } from '@nestjs/common';
import { Notification, Prisma } from '@prisma/client';
import { PrismaService } from '../database/prisma.service';

@Injectable()
export class NotificationsRepository {
  constructor(private readonly prisma: PrismaService) {}

  create(data: Prisma.NotificationCreateInput): Promise<Notification> {
    return this.prisma.notification.create({ data });
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

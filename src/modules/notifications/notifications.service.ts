import { Injectable, NotFoundException } from '@nestjs/common';
import { Notification } from '@prisma/client';
import { NotificationsRepository } from './notifications.repository';

export interface NotificationListResult {
  items: Notification[];
  total: number;
  page: number;
  limit: number;
  unreadCount: number;
}

@Injectable()
export class NotificationsService {
  constructor(private readonly repo: NotificationsRepository) {}

  /** GET /owners/me/notifications (M2 spec §4.1). */
  async list(
    ownerId: string,
    unreadOnly: boolean,
    page: number,
    limit: number,
  ): Promise<NotificationListResult> {
    const { items, total, unreadCount } = await this.repo.findManyByOwner(
      ownerId,
      unreadOnly,
      (page - 1) * limit,
      limit,
    );

    return { items, total, page, limit, unreadCount };
  }

  /**
   * PATCH /owners/me/notifications/:id/read - M2 spec edge cases 5/6:
   * 404 if the notification doesn't belong to the caller, idempotent if
   * already read.
   */
  async markRead(id: string, ownerId: string): Promise<Notification> {
    const notification = await this.repo.findById(id);
    if (!notification) {
      throw new NotFoundException('Notification not found');
    }
    if (notification.ownerId !== ownerId) {
      throw new NotFoundException('Notification not found');
    }
    if (notification.isRead) {
      return notification;
    }
    return this.repo.markRead(id);
  }

  unreadCount(ownerId: string): Promise<{ count: number }> {
    return this.repo.unreadCount(ownerId).then((count) => ({ count }));
  }

  async markAllRead(ownerId: string): Promise<{ updated: number }> {
    const updated = await this.repo.markAllRead(ownerId);
    return { updated };
  }
}

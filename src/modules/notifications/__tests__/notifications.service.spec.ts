import { NotFoundException } from '@nestjs/common';
import { Notification, NotificationType } from '@prisma/client';
import { NotificationsService } from '../notifications.service';

const now = new Date('2026-06-11T00:00:00.000Z');

function buildNotification(overrides: Partial<Notification> = {}): Notification {
  return {
    id: 'notif-1',
    ownerId: 'owner-1',
    propertyId: 'prop-1',
    type: NotificationType.approval,
    title: 'Your property is now live!',
    body: 'Congratulations!',
    actionUrl: '/owner/dashboard',
    isRead: false,
    createdAt: now,
    ...overrides,
  } as Notification;
}

describe(NotificationsService.name, () => {
  const repo = {
    create: jest.fn(),
    findManyByOwner: jest.fn(),
    findById: jest.fn(),
    markRead: jest.fn(),
    unreadCount: jest.fn(),
    markAllRead: jest.fn(),
  };

  let service: NotificationsService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new NotificationsService(repo as never);
  });

  describe('list', () => {
    it('delegates pagination and unread filtering to the repository', async () => {
      repo.findManyByOwner.mockResolvedValue({
        items: [buildNotification()],
        total: 1,
        unreadCount: 1,
      });

      const result = await service.list('owner-1', true, 2, 10);

      expect(repo.findManyByOwner).toHaveBeenCalledWith('owner-1', true, 10, 10);
      expect(result).toEqual({
        items: [buildNotification()],
        total: 1,
        page: 2,
        limit: 10,
        unreadCount: 1,
      });
    });
  });

  describe('markRead', () => {
    it('throws NotFoundException when the notification does not exist', async () => {
      repo.findById.mockResolvedValue(null);
      await expect(service.markRead('notif-1', 'owner-1')).rejects.toThrow(NotFoundException);
    });

    it('throws NotFoundException when the notification belongs to another owner', async () => {
      repo.findById.mockResolvedValue(buildNotification({ ownerId: 'owner-2' }));
      await expect(service.markRead('notif-1', 'owner-1')).rejects.toThrow(NotFoundException);
      expect(repo.markRead).not.toHaveBeenCalled();
    });

    it('is idempotent when the notification is already read', async () => {
      const notification = buildNotification({ isRead: true });
      repo.findById.mockResolvedValue(notification);

      const result = await service.markRead('notif-1', 'owner-1');

      expect(result).toBe(notification);
      expect(repo.markRead).not.toHaveBeenCalled();
    });

    it('marks an unread notification as read', async () => {
      const notification = buildNotification({ isRead: false });
      repo.findById.mockResolvedValue(notification);
      repo.markRead.mockResolvedValue(buildNotification({ isRead: true }));

      const result = await service.markRead('notif-1', 'owner-1');

      expect(repo.markRead).toHaveBeenCalledWith('notif-1');
      expect(result.isRead).toBe(true);
    });
  });

  describe('unreadCount', () => {
    it('returns the count from the repository wrapped in an object', async () => {
      repo.unreadCount.mockResolvedValue(7);

      const result = await service.unreadCount('owner-1');

      expect(repo.unreadCount).toHaveBeenCalledWith('owner-1');
      expect(result).toEqual({ count: 7 });
    });

    it('returns count 0 when there are no unread notifications', async () => {
      repo.unreadCount.mockResolvedValue(0);

      const result = await service.unreadCount('owner-1');

      expect(result).toEqual({ count: 0 });
    });
  });

  describe('markAllRead', () => {
    it('returns the number of updated rows', async () => {
      repo.markAllRead.mockResolvedValue(3);

      const result = await service.markAllRead('owner-1');

      expect(repo.markAllRead).toHaveBeenCalledWith('owner-1');
      expect(result).toEqual({ updated: 3 });
    });

    it('returns updated 0 when everything was already read', async () => {
      repo.markAllRead.mockResolvedValue(0);

      const result = await service.markAllRead('owner-1');

      expect(result).toEqual({ updated: 0 });
    });
  });
});

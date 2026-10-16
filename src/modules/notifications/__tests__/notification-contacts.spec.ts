import { NotificationType } from '@prisma/client';
import { NotificationsRepository } from '../notifications.repository';

describe('Reception notification routing', () => {
  const prisma = { notification: { create: jest.fn() }, property: { findFirst: jest.fn() } };
  const events = { emit: jest.fn() };
  const repo = new NotificationsRepository(prisma as never, events as never);
  beforeEach(() => jest.clearAllMocks());

  it('requests SMS for every persisted owner notification without duplicating dedicated status alerts', async () => {
    for (const type of Object.values(NotificationType).filter((type) => !['approval', 'revision_request'].includes(type))) {
      const data = { ownerId: 'owner', propertyId: 'property', type, title: 'Update', body: 'Details' };
      prisma.notification.create.mockResolvedValue(data);
      await repo.create(data as never);
      expect(events.emit).toHaveBeenLastCalledWith('notification.requested', expect.objectContaining({ channel: 'sms', recipientUserId: 'owner', data: expect.objectContaining({ propertyId: 'property' }) }));
    }
    events.emit.mockClear();
    for (const type of ['approval', 'revision_request']) {
      prisma.notification.create.mockResolvedValue({ type, propertyId: 'property' });
      await repo.create({} as never);
    }
    expect(events.emit).not.toHaveBeenCalled();
  });

  it('limits reception lookup to notifications for that property owner', async () => {
    prisma.property.findFirst.mockResolvedValueOnce({ receptionMobile: '9876543210' }).mockResolvedValueOnce(null);
    await expect(repo.receptionMobile('property', 'owner')).resolves.toBe('9876543210');
    expect(prisma.property.findFirst).toHaveBeenCalledWith({ where: { id: 'property', ownerId: 'owner' }, select: { receptionMobile: true } });
    await expect(repo.receptionMobile('property', 'guest')).resolves.toBeNull();
  });
});

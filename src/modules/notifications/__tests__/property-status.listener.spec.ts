import { NotificationType } from '@prisma/client';
import { DOMAIN_EVENTS } from '../../../common/events/domain-events';
import { PropertyStatusListener } from '../listeners/property-status.listener';

describe(PropertyStatusListener.name, () => {
  const repo = {
    create: jest.fn(),
  };
  const events = {
    emit: jest.fn(),
    on: jest.fn(),
  };

  let listener: PropertyStatusListener;

  beforeEach(() => {
    jest.clearAllMocks();
    listener = new PropertyStatusListener(repo as never, events as never);
  });

  describe('onModuleInit', () => {
    it('subscribes to hotel.verified, hotel.rejected and hotel.revision_requested', () => {
      listener.onModuleInit();

      const subscribed = events.on.mock.calls.map(([event]) => event);
      expect(subscribed).toEqual([
        DOMAIN_EVENTS.HOTEL_VERIFIED,
        DOMAIN_EVENTS.HOTEL_REJECTED,
        DOMAIN_EVENTS.HOTEL_REVISION_REQUESTED,
      ]);
    });
  });

  describe('hotel.verified', () => {
    it('creates an approval notification and requests email + sms delivery', async () => {
      listener.onModuleInit();
      const handler = events.on.mock.calls.find(
        ([event]) => event === DOMAIN_EVENTS.HOTEL_VERIFIED,
      )?.[1];

      await handler({ hotelId: 'prop-1', ownerId: 'owner-1', verifiedBy: 'admin-1' });

      expect(repo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          ownerId: 'owner-1',
          propertyId: 'prop-1',
          type: NotificationType.approval,
          actionUrl: '/owner/dashboard',
        }),
      );
      expect(events.emit).toHaveBeenCalledWith(
        DOMAIN_EVENTS.NOTIFICATION_REQUESTED,
        expect.objectContaining({ channel: 'email', templateId: 'property_approved', recipientUserId: 'owner-1' }),
      );
      expect(events.emit).toHaveBeenCalledWith(
        DOMAIN_EVENTS.NOTIFICATION_REQUESTED,
        expect.objectContaining({ channel: 'sms', templateId: 'property_approved', recipientUserId: 'owner-1' }),
      );
    });
  });

  describe('hotel.rejected', () => {
    it('creates a rejection notification with the reason and requests email delivery only', async () => {
      listener.onModuleInit();
      const handler = events.on.mock.calls.find(
        ([event]) => event === DOMAIN_EVENTS.HOTEL_REJECTED,
      )?.[1];

      await handler({
        hotelId: 'prop-1',
        ownerId: 'owner-1',
        rejectedBy: 'admin-1',
        reason: 'Incomplete documents',
      });

      expect(repo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          ownerId: 'owner-1',
          propertyId: 'prop-1',
          type: NotificationType.rejection,
          body: expect.stringContaining('Incomplete documents'),
          actionUrl: '/owner/dashboard',
        }),
      );
      expect(events.emit).toHaveBeenCalledTimes(1);
      expect(events.emit).toHaveBeenCalledWith(
        DOMAIN_EVENTS.NOTIFICATION_REQUESTED,
        expect.objectContaining({ channel: 'email', templateId: 'property_rejected', recipientUserId: 'owner-1' }),
      );
    });
  });

  describe('hotel.revision_requested', () => {
    it('creates a revision-request notification summarizing the items and requests email + sms delivery', async () => {
      listener.onModuleInit();
      const handler = events.on.mock.calls.find(
        ([event]) => event === DOMAIN_EVENTS.HOTEL_REVISION_REQUESTED,
      )?.[1];

      const items = [{ field: 'photos', reason: 'Add exterior photos' }];

      await handler({ hotelId: 'prop-1', ownerId: 'owner-1', requestedBy: 'admin-1', items });

      expect(repo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          ownerId: 'owner-1',
          propertyId: 'prop-1',
          type: NotificationType.revision_request,
          body: 'photos: Add exterior photos',
          actionUrl: '/owner/dashboard/documents',
        }),
      );
      expect(events.emit).toHaveBeenCalledWith(
        DOMAIN_EVENTS.NOTIFICATION_REQUESTED,
        expect.objectContaining({ channel: 'email', templateId: 'revision_requested', recipientUserId: 'owner-1' }),
      );
      expect(events.emit).toHaveBeenCalledWith(
        DOMAIN_EVENTS.NOTIFICATION_REQUESTED,
        expect.objectContaining({ channel: 'sms', templateId: 'revision_requested', recipientUserId: 'owner-1' }),
      );
    });
  });
});

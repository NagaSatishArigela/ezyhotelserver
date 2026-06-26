import { Logger } from '@nestjs/common';
import { User } from '@prisma/client';
import { DOMAIN_EVENTS, NotificationRequestedPayload } from '../../../common/events/domain-events';
import { NotificationDeliveryService } from '../services/notification-delivery.service';

function buildUser(overrides: Partial<User> = {}): User {
  return {
    id: 'owner-1',
    phone: '9876543210',
    email: 'owner@example.com',
    passwordHash: 'hash',
    globalRole: 'USER',
    isPhoneVerified: true,
    isEmailVerified: true,
    status: 'active',
    createdAt: new Date('2026-06-11T00:00:00.000Z'),
    updatedAt: new Date('2026-06-11T00:00:00.000Z'),
    ...overrides,
  } as User;
}

describe(NotificationDeliveryService.name, () => {
  beforeAll(() => {
    jest.spyOn(Logger.prototype, 'debug').mockImplementation();
    jest.spyOn(Logger.prototype, 'warn').mockImplementation();
    jest.spyOn(Logger.prototype, 'error').mockImplementation();
  });

  const config = { get: jest.fn() };
  const users = { findById: jest.fn() };
  const events = { emit: jest.fn(), on: jest.fn() };

  let service: NotificationDeliveryService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new NotificationDeliveryService(config as never, users as never, events as never);
    (global as any).fetch = jest.fn();
  });

  function getDeliverHandler(): (payload: NotificationRequestedPayload) => Promise<void> {
    service.onModuleInit();
    return events.on.mock.calls.find(([event]) => event === DOMAIN_EVENTS.NOTIFICATION_REQUESTED)?.[1];
  }

  it('subscribes to notification.requested on module init', () => {
    getDeliverHandler();
    expect(events.on).toHaveBeenCalledWith(DOMAIN_EVENTS.NOTIFICATION_REQUESTED, expect.any(Function));
  });

  it('logs and skips push notifications (not yet supported)', async () => {
    const handler = getDeliverHandler();

    await handler({ channel: 'push', templateId: 'property_approved', recipientUserId: 'owner-1', data: {} });

    expect(users.findById).not.toHaveBeenCalled();
    expect(Logger.prototype.debug).toHaveBeenCalled();
  });

  it('warns and skips when the recipient user cannot be found', async () => {
    const handler = getDeliverHandler();
    users.findById.mockResolvedValue(null);

    await handler({ channel: 'email', templateId: 'property_approved', recipientUserId: 'owner-1', data: {} });

    expect(Logger.prototype.warn).toHaveBeenCalledWith(
      'Notification recipient owner-1 not found',
    );
    expect((global as any).fetch).not.toHaveBeenCalled();
  });

  describe('email delivery', () => {
    it('warns and skips when the email gateway is not configured', async () => {
      const handler = getDeliverHandler();
      users.findById.mockResolvedValue(buildUser());
      config.get.mockReturnValue(null);

      await handler({ channel: 'email', templateId: 'property_approved', recipientUserId: 'owner-1', data: {} });

      expect((global as any).fetch).not.toHaveBeenCalled();
      expect(Logger.prototype.warn).toHaveBeenCalledWith(
        'Email gateway not configured - skipping "property_approved" for owner@example.com',
      );
    });

    it('posts to the configured email gateway with bearer auth', async () => {
      const handler = getDeliverHandler();
      users.findById.mockResolvedValue(buildUser());
      config.get.mockImplementation((key: string) => {
        switch (key) {
          case 'EMAIL_GATEWAY_URL':
            return 'https://example-email-gateway.com/send';
          case 'EMAIL_GATEWAY_API_KEY':
            return 'email-api-key';
          default:
            return null;
        }
      });
      (global as any).fetch.mockResolvedValue({ ok: true, status: 200 });

      await handler({
        channel: 'email',
        templateId: 'property_approved',
        recipientUserId: 'owner-1',
        data: { hotelId: 'prop-1' },
      });

      expect((global as any).fetch).toHaveBeenCalledWith('https://example-email-gateway.com/send', {
        method: 'POST',
        headers: {
          Authorization: 'Bearer email-api-key',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          to: 'owner@example.com',
          templateId: 'property_approved',
          data: { hotelId: 'prop-1' },
        }),
      });
    });

    it('logs an error when the email gateway responds with a non-ok status', async () => {
      const handler = getDeliverHandler();
      users.findById.mockResolvedValue(buildUser());
      config.get.mockImplementation((key: string) => {
        switch (key) {
          case 'EMAIL_GATEWAY_URL':
            return 'https://example-email-gateway.com/send';
          case 'EMAIL_GATEWAY_API_KEY':
            return 'email-api-key';
          default:
            return null;
        }
      });
      (global as any).fetch.mockResolvedValue({ ok: false, status: 500 });

      await handler({ channel: 'email', templateId: 'property_approved', recipientUserId: 'owner-1', data: {} });

      expect(Logger.prototype.error).toHaveBeenCalledWith(
        'Email gateway failed with status 500 for "property_approved"',
      );
    });
  });

  describe('sms delivery', () => {
    it('warns and skips when the sms gateway is not configured', async () => {
      const handler = getDeliverHandler();
      users.findById.mockResolvedValue(buildUser());
      config.get.mockReturnValue(null);

      await handler({ channel: 'sms', templateId: 'revision_requested', recipientUserId: 'owner-1', data: {} });

      expect((global as any).fetch).not.toHaveBeenCalled();
      expect(Logger.prototype.warn).toHaveBeenCalledWith(
        'SMS gateway not configured - skipping "revision_requested" for 98******10',
      );
    });

    it('posts to the configured sms gateway with the +91 prefix', async () => {
      const handler = getDeliverHandler();
      users.findById.mockResolvedValue(buildUser());
      config.get.mockImplementation((key: string) => {
        switch (key) {
          case 'SMS_GATEWAY_URL':
            return 'https://example-sms-gateway.com/send';
          case 'SMS_GATEWAY_API_KEY':
            return 'sms-api-key';
          default:
            return null;
        }
      });
      (global as any).fetch.mockResolvedValue({ ok: true, status: 200 });

      await handler({
        channel: 'sms',
        templateId: 'revision_requested',
        recipientUserId: 'owner-1',
        data: { hotelId: 'prop-1' },
      });

      expect((global as any).fetch).toHaveBeenCalledWith('https://example-sms-gateway.com/send', {
        method: 'POST',
        headers: {
          Authorization: 'Bearer sms-api-key',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          to: '+919876543210',
          templateId: 'revision_requested',
          data: { hotelId: 'prop-1' },
        }),
      });
    });

    it('logs an error when the sms gateway responds with a non-ok status', async () => {
      const handler = getDeliverHandler();
      users.findById.mockResolvedValue(buildUser());
      config.get.mockImplementation((key: string) => {
        switch (key) {
          case 'SMS_GATEWAY_URL':
            return 'https://example-sms-gateway.com/send';
          case 'SMS_GATEWAY_API_KEY':
            return 'sms-api-key';
          default:
            return null;
        }
      });
      (global as any).fetch.mockResolvedValue({ ok: false, status: 500 });

      await handler({ channel: 'sms', templateId: 'revision_requested', recipientUserId: 'owner-1', data: {} });

      expect(Logger.prototype.error).toHaveBeenCalledWith(
        'SMS gateway failed with status 500 for "revision_requested"',
      );
    });
  });

  it('logs delivery failures from the deliver promise without throwing', async () => {
    service.onModuleInit();
    const handler = events.on.mock.calls[0][1] as (payload: NotificationRequestedPayload) => void;
    users.findById.mockRejectedValue(new Error('db down'));

    handler({ channel: 'email', templateId: 'property_approved', recipientUserId: 'owner-1', data: {} });

    await new Promise((resolve) => setImmediate(resolve));

    expect(Logger.prototype.error).toHaveBeenCalledWith('Notification delivery failed: db down');
  });
});

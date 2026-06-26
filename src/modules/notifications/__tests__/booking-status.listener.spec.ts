import { NotificationType } from '@prisma/client';
import { DOMAIN_EVENTS } from '../../../common/events/domain-events';
import { BookingStatusListener } from '../listeners/booking-status.listener';

describe(BookingStatusListener.name, () => {
  const repo = {
    create: jest.fn(),
  };
  const events = {
    emit: jest.fn(),
    on: jest.fn(),
  };

  let listener: BookingStatusListener;

  beforeEach(() => {
    jest.clearAllMocks();
    listener = new BookingStatusListener(repo as never, events as never);
  });

  describe('onModuleInit', () => {
    it('subscribes to booking.confirmed, booking.cancelled, booking.no_show, booking.checked_in and the M5 admin-action events', () => {
      listener.onModuleInit();

      const subscribed = events.on.mock.calls.map(([event]) => event);
      expect(subscribed).toEqual([
        DOMAIN_EVENTS.BOOKING_CONFIRMED,
        DOMAIN_EVENTS.BOOKING_CANCELLED,
        DOMAIN_EVENTS.BOOKING_NO_SHOW,
        DOMAIN_EVENTS.BOOKING_CHECKED_IN,
        DOMAIN_EVENTS.BOOKING_VOIDED,
        DOMAIN_EVENTS.BOOKING_REFUNDED,
        DOMAIN_EVENTS.BOOKING_EXTENDED,
      ]);
    });
  });

  describe('booking.confirmed', () => {
    it('creates an owner notification and requests guest email delivery', async () => {
      listener.onModuleInit();
      const handler = events.on.mock.calls.find(([event]) => event === DOMAIN_EVENTS.BOOKING_CONFIRMED)?.[1];

      await handler({
        bookingId: 'booking-1',
        bookingRef: 'PPH-B-00001',
        hotelId: 'prop-1',
        ownerId: 'owner-1',
        roomId: 'room-1',
        guestUserId: 'guest-1',
        bookingType: 'hourly',
        checkIn: '2026-06-15T10:00:00.000Z',
        checkOut: '2026-06-15T13:00:00.000Z',
        amountPaise: 283200,
      });

      expect(repo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          ownerId: 'owner-1',
          propertyId: 'prop-1',
          type: NotificationType.booking_update,
          body: expect.stringContaining('PPH-B-00001'),
          actionUrl: '/owner/dashboard/bookings',
        }),
      );
      expect(events.emit).toHaveBeenCalledWith(
        DOMAIN_EVENTS.NOTIFICATION_REQUESTED,
        expect.objectContaining({ channel: 'email', templateId: 'booking_confirmed', recipientUserId: 'guest-1' }),
      );
    });
  });

  describe('booking.cancelled', () => {
    it('creates an owner notification with the reason and requests guest email delivery with the refund amount', async () => {
      listener.onModuleInit();
      const handler = events.on.mock.calls.find(([event]) => event === DOMAIN_EVENTS.BOOKING_CANCELLED)?.[1];

      await handler({
        bookingId: 'booking-1',
        bookingRef: 'PPH-B-00001',
        hotelId: 'prop-1',
        ownerId: 'owner-1',
        guestUserId: 'guest-1',
        reason: 'change of plans',
        refundAmountPaise: 283200,
      });

      expect(repo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          ownerId: 'owner-1',
          propertyId: 'prop-1',
          type: NotificationType.booking_update,
          body: expect.stringContaining('change of plans'),
          actionUrl: '/owner/dashboard/bookings',
        }),
      );
      expect(events.emit).toHaveBeenCalledWith(
        DOMAIN_EVENTS.NOTIFICATION_REQUESTED,
        expect.objectContaining({
          channel: 'email',
          templateId: 'booking_cancelled',
          recipientUserId: 'guest-1',
          data: expect.objectContaining({ refundAmountPaise: 283200 }),
        }),
      );
    });
  });

  describe('booking.no_show', () => {
    it('creates an owner notification only', async () => {
      listener.onModuleInit();
      const handler = events.on.mock.calls.find(([event]) => event === DOMAIN_EVENTS.BOOKING_NO_SHOW)?.[1];

      await handler({
        bookingId: 'booking-1',
        bookingRef: 'PPH-B-00001',
        hotelId: 'prop-1',
        ownerId: 'owner-1',
        guestUserId: 'guest-1',
        reason: 'Guest did not check in within the 30-minute grace period.',
      });

      expect(repo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          ownerId: 'owner-1',
          propertyId: 'prop-1',
          type: NotificationType.booking_update,
          body: expect.stringContaining('no-show'),
          actionUrl: '/owner/dashboard/bookings',
        }),
      );
      expect(events.emit).not.toHaveBeenCalled();
    });
  });

  describe('booking.checked_in', () => {
    it('creates an owner notification only', async () => {
      listener.onModuleInit();
      const handler = events.on.mock.calls.find(([event]) => event === DOMAIN_EVENTS.BOOKING_CHECKED_IN)?.[1];

      await handler({
        bookingId: 'booking-1',
        bookingRef: 'PPH-B-00001',
        hotelId: 'prop-1',
        ownerId: 'owner-1',
        roomId: 'room-1',
        guestUserId: 'guest-1',
        at: '2026-06-15T10:00:00.000Z',
      });

      expect(repo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          ownerId: 'owner-1',
          propertyId: 'prop-1',
          type: NotificationType.booking_update,
          body: expect.stringContaining('checked in'),
          actionUrl: '/owner/dashboard/bookings',
        }),
      );
      expect(events.emit).not.toHaveBeenCalled();
    });
  });

  describe('booking.voided', () => {
    it('creates an owner notification with the reason and requests guest email delivery', async () => {
      listener.onModuleInit();
      const handler = events.on.mock.calls.find(([event]) => event === DOMAIN_EVENTS.BOOKING_VOIDED)?.[1];

      await handler({
        bookingId: 'booking-1',
        bookingRef: 'PPH-B-00001',
        hotelId: 'prop-1',
        ownerId: 'owner-1',
        guestUserId: 'guest-1',
        voidedBy: 'admin-1',
        reason: 'Suspected fraud',
        refundAmountPaise: 283200,
      });

      expect(repo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          ownerId: 'owner-1',
          propertyId: 'prop-1',
          type: NotificationType.booking_update,
          body: expect.stringContaining('Suspected fraud'),
          actionUrl: '/owner/dashboard/bookings',
        }),
      );
      expect(events.emit).toHaveBeenCalledWith(
        DOMAIN_EVENTS.NOTIFICATION_REQUESTED,
        expect.objectContaining({
          channel: 'email',
          templateId: 'booking_voided',
          recipientUserId: 'guest-1',
          data: expect.objectContaining({ refundAmountPaise: 283200 }),
        }),
      );
    });
  });

  describe('booking.refunded', () => {
    it('creates an owner notification and requests guest email delivery', async () => {
      listener.onModuleInit();
      const handler = events.on.mock.calls.find(([event]) => event === DOMAIN_EVENTS.BOOKING_REFUNDED)?.[1];

      await handler({
        bookingId: 'booking-1',
        bookingRef: 'PPH-B-00001',
        hotelId: 'prop-1',
        ownerId: 'owner-1',
        guestUserId: 'guest-1',
        amountPaise: 50000,
        isPartial: true,
        reason: 'Goodwill',
      });

      expect(repo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          ownerId: 'owner-1',
          propertyId: 'prop-1',
          type: NotificationType.booking_update,
          body: expect.stringContaining('partial'),
          actionUrl: '/owner/dashboard/bookings',
        }),
      );
      expect(events.emit).toHaveBeenCalledWith(
        DOMAIN_EVENTS.NOTIFICATION_REQUESTED,
        expect.objectContaining({
          channel: 'email',
          templateId: 'booking_refunded',
          recipientUserId: 'guest-1',
          data: expect.objectContaining({ amountPaise: 50000, isPartial: true }),
        }),
      );
    });
  });

  describe('booking.extended', () => {
    it('creates an owner notification and requests guest email delivery', async () => {
      listener.onModuleInit();
      const handler = events.on.mock.calls.find(([event]) => event === DOMAIN_EVENTS.BOOKING_EXTENDED)?.[1];

      await handler({
        bookingId: 'booking-1',
        bookingRef: 'PPH-B-00001',
        hotelId: 'prop-1',
        ownerId: 'owner-1',
        guestUserId: 'guest-1',
        newCheckOutAt: '2026-06-13T20:00:00.000Z',
        extensionAmountPaise: 50000,
      });

      expect(repo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          ownerId: 'owner-1',
          propertyId: 'prop-1',
          type: NotificationType.booking_update,
          body: expect.stringContaining('extended'),
          actionUrl: '/owner/dashboard/bookings',
        }),
      );
      expect(events.emit).toHaveBeenCalledWith(
        DOMAIN_EVENTS.NOTIFICATION_REQUESTED,
        expect.objectContaining({
          channel: 'email',
          templateId: 'booking_extended',
          recipientUserId: 'guest-1',
          data: expect.objectContaining({ newCheckOutAt: '2026-06-13T20:00:00.000Z' }),
        }),
      );
    });
  });
});

import { NotificationType } from '@prisma/client';
import { DOMAIN_EVENTS } from '../../../common/events/domain-events';
import { PayoutReleasedListener } from '../listeners/payout-released.listener';

describe(PayoutReleasedListener.name, () => {
  const repo = { create: jest.fn() };
  const events = { on: jest.fn() };

  let listener: PayoutReleasedListener;

  beforeEach(() => {
    jest.clearAllMocks();
    listener = new PayoutReleasedListener(repo as never, events as never);
  });

  describe('onModuleInit', () => {
    it('subscribes to payout.released', () => {
      listener.onModuleInit();

      const subscribed = events.on.mock.calls.map(([event]) => event);
      expect(subscribed).toEqual([DOMAIN_EVENTS.PAYOUT_RELEASED]);
    });
  });

  describe('payout.released', () => {
    const payload = {
      payoutItemId: 'item-1',
      ownerId: 'owner-1',
      propertyId: 'prop-1',
      netAmountPaise: 50000,
      batchRef: 'BATCH-2026-06-16',
    };

    async function fireHandler() {
      listener.onModuleInit();
      const handler = events.on.mock.calls[0][1];
      await handler(payload);
    }

    it('creates a payout_released notification for the owner', async () => {
      await fireHandler();

      expect(repo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          ownerId: 'owner-1',
          propertyId: 'prop-1',
          type: NotificationType.payout_released,
          actionUrl: '/owner/payouts',
        }),
      );
    });

    it('includes the batch reference in the notification title', async () => {
      await fireHandler();

      expect(repo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          title: expect.stringContaining('BATCH-2026-06-16'),
        }),
      );
    });

    it('formats the net amount in INR in the notification body', async () => {
      await fireHandler();

      const call = repo.create.mock.calls[0][0];
      // ₹500 (50000 paise) should appear somewhere in the body
      expect(call.body).toMatch(/500/);
    });

    it('does not emit further domain events (fire-and-forget)', async () => {
      await fireHandler();
      // events.on registered the listener; no emit should have been called
      expect(events.on).toHaveBeenCalledTimes(1);
    });
  });
});

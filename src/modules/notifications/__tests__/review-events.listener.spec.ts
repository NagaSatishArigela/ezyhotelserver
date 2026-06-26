import { NotificationType } from '@prisma/client';
import { DOMAIN_EVENTS } from '../../../common/events/domain-events';
import { ReviewEventsListener } from '../listeners/review-events.listener';

describe(ReviewEventsListener.name, () => {
  const repo = { create: jest.fn() };
  const events = { on: jest.fn() };

  let listener: ReviewEventsListener;

  beforeEach(() => {
    jest.clearAllMocks();
    listener = new ReviewEventsListener(repo as never, events as never);
  });

  describe('onModuleInit', () => {
    it('subscribes to review.new_on_property', () => {
      listener.onModuleInit();

      const subscribed = events.on.mock.calls.map(([event]) => event);
      expect(subscribed).toEqual([DOMAIN_EVENTS.REVIEW_NEW_ON_PROPERTY]);
    });
  });

  describe('review.new_on_property', () => {
    const payload = {
      reviewId: 'rev-1',
      propertyId: 'prop-1',
      ownerId: 'owner-1',
      scoreOverall: 4,
    };

    async function fireHandler() {
      listener.onModuleInit();
      const handler = events.on.mock.calls[0][1];
      await handler(payload);
    }

    it('creates a review_new_on_property notification for the owner', async () => {
      await fireHandler();

      expect(repo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          ownerId: 'owner-1',
          propertyId: 'prop-1',
          type: NotificationType.review_new_on_property,
          actionUrl: '/owner/reviews',
        }),
      );
    });

    it('includes the overall score in the notification body', async () => {
      await fireHandler();

      expect(repo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          body: expect.stringContaining('4/5'),
        }),
      );
    });

    it('mentions the 96-hour reply window in the body', async () => {
      await fireHandler();

      const call = repo.create.mock.calls[0][0];
      expect(call.body).toMatch(/96 hours/i);
    });

    it('creates separate notifications for different owners', async () => {
      listener.onModuleInit();
      const handler = events.on.mock.calls[0][1];

      await handler({ ...payload, ownerId: 'owner-A', propertyId: 'prop-A' });
      await handler({ ...payload, ownerId: 'owner-B', propertyId: 'prop-B' });

      expect(repo.create).toHaveBeenCalledTimes(2);
      expect(repo.create).toHaveBeenNthCalledWith(
        1,
        expect.objectContaining({ ownerId: 'owner-A', propertyId: 'prop-A' }),
      );
      expect(repo.create).toHaveBeenNthCalledWith(
        2,
        expect.objectContaining({ ownerId: 'owner-B', propertyId: 'prop-B' }),
      );
    });
  });
});

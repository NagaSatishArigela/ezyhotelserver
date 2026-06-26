import { BadRequestException, NotFoundException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { PayoutBatch, PayoutBatchStatus, PayoutItem, PayoutItemStatus } from '@prisma/client';
import { DOMAIN_EVENTS } from '../../../common/events/domain-events';
import { TypedEventEmitter } from '../../../common/events/typed-event-emitter.service';
import { GenerateBatchDto } from '../dto/generate-batch.dto';
import { CompletedBookingRow, PayoutsRepository } from '../payouts.repository';
import { PayoutsService } from '../payouts.service';

function makeBatch(overrides: Partial<PayoutBatch> = {}): PayoutBatch {
  return {
    id: 'batch-1',
    batchRef: 'PAY-20260615',
    cycleStartAt: new Date('2026-06-09T00:00:00.000Z'),
    cycleEndAt: new Date('2026-06-15T23:59:59.999Z'),
    status: PayoutBatchStatus.pending,
    totalGrossPaise: 0,
    totalTdsPaise: 0,
    totalNetPaise: 0,
    itemCount: 0,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

function makeItem(overrides: Partial<PayoutItem> = {}): PayoutItem {
  return {
    id: 'item-1',
    batchId: 'batch-1',
    propertyId: 'prop-1',
    ownerId: 'owner-1',
    status: PayoutItemStatus.pending,
    bookingCount: 2,
    grossAmountPaise: 100_000,
    tdsPaise: 1_000,
    netAmountPaise: 99_000,
    holdReason: null,
    bankRef: null,
    releasedAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

function makeBookingRow(overrides: Partial<CompletedBookingRow> = {}): CompletedBookingRow {
  return {
    booking_id: 'bk-1',
    property_id: 'prop-1',
    owner_id: 'owner-1',
    base_amount_paise: 110_000n,
    platform_fee_paise: 10_000n,
    refund_amount_paise: 0n,
    ...overrides,
  };
}

describe('PayoutsService', () => {
  let service: PayoutsService;
  let repo: jest.Mocked<PayoutsRepository>;
  let emitter: jest.Mocked<TypedEventEmitter>;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PayoutsService,
        {
          provide: PayoutsRepository,
          useValue: {
            createBatch: jest.fn(),
            createBatchAtomic: jest.fn(),
            updateBatch: jest.fn(),
            findBatchById: jest.fn(),
            findBatchWithItems: jest.fn(),
            findItemById: jest.fn(),
            updateItem: jest.fn(),
            getCompletedBookingsForCycle: jest.fn(),
            upsertBatchItems: jest.fn(),
            listBatchesAdmin: jest.fn(),
            adminSummary: jest.fn(),
            listOwnerItems: jest.fn(),
            ownerItemDetail: jest.fn(),
          },
        },
        {
          provide: TypedEventEmitter,
          useValue: { emit: jest.fn() },
        },
      ],
    }).compile();

    service = module.get(PayoutsService);
    repo = module.get(PayoutsRepository);
    emitter = module.get(TypedEventEmitter);
  });

  describe('generateBatch', () => {
    const dto: GenerateBatchDto = {
      cycleStartAt: '2026-06-09T00:00:00.000Z',
      cycleEndAt: '2026-06-15T23:59:59.999Z',
    };

    it('creates a batch and groups bookings by property', async () => {
      const batch = makeBatch({ id: 'batch-1', status: PayoutBatchStatus.pending, totalNetPaise: 346_500 });
      repo.getCompletedBookingsForCycle.mockResolvedValue([
        makeBookingRow({ booking_id: 'bk-1', property_id: 'prop-1', base_amount_paise: 110_000n, platform_fee_paise: 10_000n }),
        makeBookingRow({ booking_id: 'bk-2', property_id: 'prop-1', base_amount_paise: 220_000n, platform_fee_paise: 20_000n }),
        makeBookingRow({ booking_id: 'bk-3', property_id: 'prop-2', owner_id: 'owner-2', base_amount_paise: 55_000n, platform_fee_paise: 5_000n }),
      ]);
      repo.createBatchAtomic.mockResolvedValue(batch);

      const result = await service.generateBatch(dto);

      expect(result.itemCount).toBe(2);
      // prop-1: (110k-10k) + (220k-20k) = 100k + 200k = 300k gross, tds=3k, net=297k
      // prop-2: 55k-5k = 50k gross, tds=500, net=49500
      expect(result.totalNetPaise).toBe(297_000 + 49_500);

      const [, , , items] = repo.createBatchAtomic.mock.calls[0];
      expect(items).toHaveLength(2);
      const prop1 = items.find((i: { propertyId: string }) => i.propertyId === 'prop-1')!;
      expect(prop1.bookings).toHaveLength(2);
      expect(prop1.bookings[0]).toMatchObject({ bookingId: 'bk-1', ownerGrossPaise: 100_000, tdsPaise: 1_000 });
    });

    it('excludes fully-refunded bookings (ownerGross = 0)', async () => {
      repo.getCompletedBookingsForCycle.mockResolvedValue([
        // fully refunded: base=100k, fee=10k, refund=90k → gross = max(0, 100k-10k-90k) = 0
        makeBookingRow({ base_amount_paise: 100_000n, platform_fee_paise: 10_000n, refund_amount_paise: 90_000n }),
      ]);
      repo.createBatchAtomic.mockResolvedValue(makeBatch({ itemCount: 0, totalNetPaise: 0 }));

      const result = await service.generateBatch(dto);

      expect(result.itemCount).toBe(0);
      const [, , , items] = repo.createBatchAtomic.mock.calls[0];
      expect(items).toHaveLength(0);
    });

    it('computes TDS as 1% of ownerGross (rounded)', async () => {
      repo.getCompletedBookingsForCycle.mockResolvedValue([
        // ownerGross = 99_999 → tds = round(999.99) = 1000
        makeBookingRow({ base_amount_paise: 109_999n, platform_fee_paise: 10_000n, refund_amount_paise: 0n }),
      ]);
      repo.createBatchAtomic.mockResolvedValue(makeBatch());

      await service.generateBatch(dto);

      const [, , , items] = repo.createBatchAtomic.mock.calls[0];
      expect(items[0].bookings[0].tdsPaise).toBe(1000); // round(99999 * 0.01) = round(999.99) = 1000
    });

    it('handles partially-refunded booking correctly', async () => {
      repo.getCompletedBookingsForCycle.mockResolvedValue([
        // base=200k, fee=20k, refund=50k → gross = 200k-20k-50k = 130k, tds=1300
        makeBookingRow({ base_amount_paise: 200_000n, platform_fee_paise: 20_000n, refund_amount_paise: 50_000n }),
      ]);
      repo.createBatchAtomic.mockResolvedValue(makeBatch());

      await service.generateBatch(dto);

      const [, , , items] = repo.createBatchAtomic.mock.calls[0];
      expect(items[0].bookings[0].ownerGrossPaise).toBe(130_000);
      expect(items[0].bookings[0].tdsPaise).toBe(1_300);
    });
  });

  describe('holdItem', () => {
    it('sets item to on_hold with reason', async () => {
      repo.findItemById.mockResolvedValue(makeItem({ status: PayoutItemStatus.pending }));
      repo.updateItem.mockResolvedValue(makeItem({ status: PayoutItemStatus.on_hold, holdReason: 'compliance review' }));

      const result = await service.holdItem('item-1', 'compliance review');

      expect(repo.updateItem).toHaveBeenCalledWith('item-1', expect.objectContaining({ status: PayoutItemStatus.on_hold, holdReason: 'compliance review' }));
      expect(result.status).toBe(PayoutItemStatus.on_hold);
    });

    it('throws NotFoundException when item not found', async () => {
      repo.findItemById.mockResolvedValue(null);
      await expect(service.holdItem('item-1', 'reason')).rejects.toThrow(NotFoundException);
    });

    it('throws BadRequestException when item is not pending', async () => {
      repo.findItemById.mockResolvedValue(makeItem({ status: PayoutItemStatus.released }));
      await expect(service.holdItem('item-1', 'reason')).rejects.toThrow(BadRequestException);
    });
  });

  describe('releaseItem', () => {
    it('releases a held item and emits PAYOUT_RELEASED event', async () => {
      const item = makeItem({ status: PayoutItemStatus.on_hold, holdReason: 'old reason' });
      repo.findItemById.mockResolvedValue(item);
      repo.findBatchById.mockResolvedValue(makeBatch({ batchRef: 'PAY-20260615' }));
      repo.updateItem.mockResolvedValue(makeItem({ status: PayoutItemStatus.released, releasedAt: new Date() }));

      await service.releaseItem('item-1');

      expect(repo.updateItem).toHaveBeenCalledWith('item-1', expect.objectContaining({
        status: PayoutItemStatus.released,
        holdReason: null,
      }));
      expect(emitter.emit).toHaveBeenCalledWith(
        DOMAIN_EVENTS.PAYOUT_RELEASED,
        expect.objectContaining({ payoutItemId: 'item-1', ownerId: 'owner-1', batchRef: 'PAY-20260615' }),
      );
    });

    it('throws BadRequestException when item is not on_hold', async () => {
      repo.findItemById.mockResolvedValue(makeItem({ status: PayoutItemStatus.pending }));
      await expect(service.releaseItem('item-1')).rejects.toThrow(BadRequestException);
    });
  });

  describe('releaseBatch', () => {
    it('releases all pending items and marks batch released', async () => {
      const item1 = makeItem({ id: 'item-1', status: PayoutItemStatus.pending });
      const item2 = makeItem({ id: 'item-2', status: PayoutItemStatus.pending });
      repo.findBatchWithItems.mockResolvedValue({
        ...makeBatch({ status: PayoutBatchStatus.pending }),
        items: [
          { ...item1, bookings: [] },
          { ...item2, bookings: [] },
        ],
      } as any);
      repo.updateItem.mockImplementation(async (id, data) => makeItem({ id, ...data } as any));
      repo.updateBatch.mockResolvedValue(makeBatch({ status: PayoutBatchStatus.released }));

      const result = await service.releaseBatch('batch-1');

      expect(result.released).toBe(2);
      expect(result.skipped).toBe(0);
      expect(repo.updateBatch).toHaveBeenCalledWith('batch-1', { status: PayoutBatchStatus.released });
    });

    it('skips on_hold items and marks batch partial', async () => {
      const pending = makeItem({ id: 'item-1', status: PayoutItemStatus.pending });
      const held = makeItem({ id: 'item-2', status: PayoutItemStatus.on_hold });
      repo.findBatchWithItems.mockResolvedValue({
        ...makeBatch({ status: PayoutBatchStatus.pending }),
        items: [
          { ...pending, bookings: [] },
          { ...held, bookings: [] },
        ],
      } as any);
      repo.updateItem.mockImplementation(async (id, data) => makeItem({ id, ...data } as any));
      repo.updateBatch.mockResolvedValue(makeBatch({ status: PayoutBatchStatus.partial }));

      const result = await service.releaseBatch('batch-1');

      expect(result.released).toBe(1);
      expect(result.skipped).toBe(1);
      expect(repo.updateBatch).toHaveBeenCalledWith('batch-1', { status: PayoutBatchStatus.partial });
    });

    it('throws BadRequestException if batch is already released', async () => {
      repo.findBatchWithItems.mockResolvedValue({
        ...makeBatch({ status: PayoutBatchStatus.released }),
        items: [],
      } as any);
      await expect(service.releaseBatch('batch-1')).rejects.toThrow(BadRequestException);
    });

    it('throws NotFoundException if batch does not exist', async () => {
      repo.findBatchWithItems.mockResolvedValue(null);
      await expect(service.releaseBatch('batch-1')).rejects.toThrow(NotFoundException);
    });
  });
});

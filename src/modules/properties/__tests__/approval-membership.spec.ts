import { PropertiesRepository } from '../properties.repository';
describe('Approval and owner activation transaction', () => {
  const tx = {
    property: { updateMany: jest.fn(), findUniqueOrThrow: jest.fn() },
    userPropertyRole: { upsert: jest.fn() },
    propertyModerationLog: { create: jest.fn() },
  };
  const prisma = { $transaction: jest.fn(async (callback) => callback(tx)) };
  const repo = new PropertiesRepository(prisma as never);
  beforeEach(() => {
    jest.clearAllMocks();
    tx.property.updateMany.mockResolvedValue({ count: 1 });
  });
  it('conditionally approves and activates ownership in the same transaction', async () => {
    await repo.approveWithOwner('hotel', 'owner', 'admin');
    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    expect(tx.property.updateMany).toHaveBeenCalledWith({
      where: { id: 'hotel', status: 'pending_review' },
      data: { status: 'approved' },
    });
    expect(tx.userPropertyRole.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { userId_propertyId: { userId: 'owner', propertyId: 'hotel' } },
        update: { role: 'OWNER', hotelRoleId: null },
      }),
    );
    expect(tx.propertyModerationLog.create).toHaveBeenCalledWith({
      data: { propertyId: 'hotel', adminId: 'admin', action: 'approved' },
    });
  });
  it('does not grant membership when a concurrent moderation already changed status', async () => {
    tx.property.updateMany.mockResolvedValue({ count: 0 });
    expect(await repo.approveWithOwner('hotel', 'owner', 'admin')).toBeNull();
    expect(tx.userPropertyRole.upsert).not.toHaveBeenCalled();
    expect(tx.propertyModerationLog.create).not.toHaveBeenCalled();
  });
});

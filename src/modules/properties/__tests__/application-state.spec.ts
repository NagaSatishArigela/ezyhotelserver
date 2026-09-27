import { ApplicationStateService } from '../application-state';
describe('encrypted incomplete application state', () => {
  const prisma = { $executeRaw: jest.fn(), property: { findUnique: jest.fn() } };
  const encryption = { encrypt: jest.fn(), decrypt: jest.fn() };
  const service = new ApplicationStateService(prisma as never, encryption as never);
  beforeEach(() => { jest.clearAllMocks(); prisma.$executeRaw.mockResolvedValue(1); encryption.encrypt.mockReturnValue('encrypted-snapshot'); });
  it('encrypts incomplete bank and document data before saving it separately from validated steps', async () => {
    const data = { 5: { docUrls: { pan: 'private-reference' } }, 6: { accountNumber: '123456789' } };
    await service.save('11111111-1111-4111-8111-111111111111', data);
    expect(encryption.encrypt).toHaveBeenCalledWith(JSON.stringify(data));
    expect(prisma.$executeRaw.mock.calls[0].slice(1)).toEqual(['"encrypted-snapshot"', '11111111-1111-4111-8111-111111111111']);
    expect(JSON.stringify(prisma.$executeRaw.mock.calls)).not.toContain('123456789');
  });
  it('restores the encrypted snapshot without treating it as validated submission data', async () => {
    prisma.property.findUnique.mockResolvedValue({ draftData: { portalSnapshot: 'encrypted-snapshot', step1: { propertyName: 'Canonical' } } });
    encryption.decrypt.mockReturnValue(JSON.stringify({ 1: { ownerName: 'Partial owner' } }));
    await expect(service.read('property')).resolves.toEqual({ 1: { ownerName: 'Partial owner' } });
  });
  it.each([null, [], { 9: {} }, { 1: [] }])('rejects malformed application snapshots', async data => {
    await expect(service.save('property', data)).rejects.toThrow('Invalid application');
    expect(prisma.$executeRaw).not.toHaveBeenCalled();
  });
  it('rejects oversized snapshots and noneditable applications', async () => {
    await expect(service.save('property', { 1: { text: 'x'.repeat(130 * 1024) } })).rejects.toThrow('too large');
    prisma.$executeRaw.mockResolvedValueOnce(0);
    await expect(service.save('property', { 1: {} })).rejects.toThrow('no longer editable');
  });
});

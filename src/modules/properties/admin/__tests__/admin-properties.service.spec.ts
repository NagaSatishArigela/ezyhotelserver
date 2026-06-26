import { ConflictException, NotFoundException } from '@nestjs/common';
import { ModerationAction, Property, PropertyStatus } from '@prisma/client';
import { DOMAIN_EVENTS } from '../../../../common/events/domain-events';
import { AdminComplianceSummary } from '../../compliance/compliance.service';
import { AdminPropertiesService } from '../admin-properties.service';

const now = new Date('2026-06-11T00:00:00.000Z');

function buildProperty(overrides: Partial<Property> = {}): Property {
  return {
    id: 'prop-1',
    name: 'Sunrise Hotel',
    ownerId: 'owner-1',
    createdAt: now,
    updatedAt: now,
    status: PropertyStatus.pending_review,
    draftStep: null,
    draftData: null,
    submissionRef: 'PPH-2026-00001',
    submittedAt: now,
    revisionCount: 0,
    revisionNotes: null,
    propertyType: null,
    bookingPolicy: null,
    category: null,
    description: null,
    ownerFirstName: null,
    ownerMiddleName: null,
    ownerLastName: null,
    addressLine1: null,
    addressLine2: null,
    city: null,
    state: null,
    pincode: null,
    landmark: null,
    specialNote: null,
    latitude: null,
    longitude: null,
    amenities: [],
    houseRules: null,
    minBookingHours: null,
    defaultCheckinTime: null,
    defaultCheckoutTime: null,
    seatingCapacity: null,
    deletionRequestedAt: null,
    deletionScheduledFor: null,
    deletionTrack: null,
    isActive: true,
    ...overrides,
  } as Property;
}

const adminComplianceSummary: AdminComplianceSummary = {
  legalBusinessName: 'Sunrise Hospitality',
  gstin: '29ABCDE1234F1Z5',
  pan: 'ABCDE1234F',
  bankAccountNumber: '123456789012',
  ifsc: 'HDFC0000123',
  accountHolderName: 'Ravi Kumar',
  documents: [],
};

describe(AdminPropertiesService.name, () => {
  const repo = {
    findManyByStatus: jest.fn(),
    findById: jest.fn(),
    update: jest.fn(),
    findRoomTypes: jest.fn(),
    findPhotos: jest.fn(),
    createModerationLog: jest.fn(),
  };
  const compliance = {
    getAdminSummary: jest.fn(),
  };
  const events = {
    emit: jest.fn(),
    on: jest.fn(),
  };

  let service: AdminPropertiesService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new AdminPropertiesService(repo as never, compliance as never, events as never);
  });

  describe('listQueue', () => {
    it('paginates and maps properties to queue items', async () => {
      repo.findManyByStatus.mockResolvedValue({ items: [buildProperty()], total: 1 });

      const result = await service.listQueue(PropertyStatus.pending_review, 2, 10);

      expect(repo.findManyByStatus).toHaveBeenCalledWith(PropertyStatus.pending_review, 10, 10);
      expect(result).toEqual({
        items: [
          {
            id: 'prop-1',
            name: 'Sunrise Hotel',
            ownerId: 'owner-1',
            status: PropertyStatus.pending_review,
            submissionRef: 'PPH-2026-00001',
            submittedAt: now,
            revisionCount: 0,
          },
        ],
        total: 1,
        page: 2,
        limit: 10,
      });
    });
  });

  describe('getDetail', () => {
    it('throws NotFoundException for an unknown property', async () => {
      repo.findById.mockResolvedValue(null);
      await expect(service.getDetail('missing')).rejects.toThrow(NotFoundException);
    });

    it('combines property, room types, photos and decrypted compliance', async () => {
      const property = buildProperty();
      repo.findById.mockResolvedValue(property);
      repo.findRoomTypes.mockResolvedValue([]);
      repo.findPhotos.mockResolvedValue([]);
      compliance.getAdminSummary.mockResolvedValue(adminComplianceSummary);

      const result = await service.getDetail('prop-1');

      expect(result).toEqual({
        property,
        roomTypes: [],
        photos: [],
        compliance: adminComplianceSummary,
      });
    });
  });

  describe('approve', () => {
    it('rejects properties that are not pending_review', async () => {
      repo.findById.mockResolvedValue(buildProperty({ status: PropertyStatus.draft }));
      await expect(service.approve('prop-1', 'admin-1')).rejects.toThrow(ConflictException);
    });

    it('marks the property approved, logs the action and emits hotel.verified', async () => {
      const property = buildProperty();
      repo.findById.mockResolvedValue(property);
      repo.update.mockResolvedValue(buildProperty({ status: PropertyStatus.approved }));

      const result = await service.approve('prop-1', 'admin-1');

      expect(repo.update).toHaveBeenCalledWith('prop-1', { status: PropertyStatus.approved });
      expect(repo.createModerationLog).toHaveBeenCalledWith({
        propertyId: 'prop-1',
        adminId: 'admin-1',
        action: ModerationAction.approved,
      });
      expect(events.emit).toHaveBeenCalledWith(DOMAIN_EVENTS.HOTEL_VERIFIED, {
        hotelId: 'prop-1',
        ownerId: 'owner-1',
        verifiedBy: 'admin-1',
      });
      expect(result).toEqual({ propertyId: 'prop-1', status: PropertyStatus.approved });
    });
  });

  describe('reject', () => {
    it('rejects properties that are not pending_review', async () => {
      repo.findById.mockResolvedValue(buildProperty({ status: PropertyStatus.approved }));
      await expect(service.reject('prop-1', 'admin-1', 'bad photos')).rejects.toThrow(
        ConflictException,
      );
    });

    it('marks the property rejected, logs the reason and emits hotel.rejected', async () => {
      const property = buildProperty();
      repo.findById.mockResolvedValue(property);
      repo.update.mockResolvedValue(buildProperty({ status: PropertyStatus.rejected }));

      const result = await service.reject('prop-1', 'admin-1', 'Incomplete documents');

      expect(repo.update).toHaveBeenCalledWith('prop-1', { status: PropertyStatus.rejected });
      expect(repo.createModerationLog).toHaveBeenCalledWith({
        propertyId: 'prop-1',
        adminId: 'admin-1',
        action: ModerationAction.rejected,
        reason: 'Incomplete documents',
      });
      expect(events.emit).toHaveBeenCalledWith(DOMAIN_EVENTS.HOTEL_REJECTED, {
        hotelId: 'prop-1',
        ownerId: 'owner-1',
        rejectedBy: 'admin-1',
        reason: 'Incomplete documents',
      });
      expect(result).toEqual({ propertyId: 'prop-1', status: PropertyStatus.rejected });
    });
  });

  describe('requestRevision', () => {
    const items = [{ field: 'photos', reason: 'Add exterior photos' }];

    it('rejects properties that are not pending_review', async () => {
      repo.findById.mockResolvedValue(buildProperty({ status: PropertyStatus.approved }));
      await expect(service.requestRevision('prop-1', 'admin-1', items)).rejects.toThrow(
        ConflictException,
      );
    });

    it('moves the property to needs_revision, appends notes and emits hotel.revision_requested', async () => {
      jest.useFakeTimers().setSystemTime(now);
      const property = buildProperty({ revisionCount: 0, revisionNotes: null });
      repo.findById.mockResolvedValue(property);
      repo.update.mockResolvedValue(
        buildProperty({ status: PropertyStatus.needs_revision, revisionCount: 1 }),
      );

      const result = await service.requestRevision('prop-1', 'admin-1', items);

      expect(repo.createModerationLog).toHaveBeenCalledWith({
        propertyId: 'prop-1',
        adminId: 'admin-1',
        action: ModerationAction.revision_requested,
        revisionItems: items,
      });
      expect(repo.update).toHaveBeenCalledWith('prop-1', {
        status: PropertyStatus.needs_revision,
        revisionCount: 1,
        revisionNotes: [{ adminId: 'admin-1', timestamp: now.toISOString(), items }],
      });
      expect(events.emit).toHaveBeenCalledWith(DOMAIN_EVENTS.HOTEL_REVISION_REQUESTED, {
        hotelId: 'prop-1',
        ownerId: 'owner-1',
        requestedBy: 'admin-1',
        items,
      });
      expect(result).toEqual({ propertyId: 'prop-1', status: PropertyStatus.needs_revision });
      jest.useRealTimers();
    });

    it('appends to existing revisionNotes rather than overwriting them', async () => {
      jest.useFakeTimers().setSystemTime(now);
      const existingNote = { adminId: 'admin-0', timestamp: '2026-01-01T00:00:00.000Z', items: [] };
      const property = buildProperty({ revisionCount: 1, revisionNotes: [existingNote] });
      repo.findById.mockResolvedValue(property);
      repo.update.mockResolvedValue(
        buildProperty({ status: PropertyStatus.needs_revision, revisionCount: 2 }),
      );

      await service.requestRevision('prop-1', 'admin-1', items);

      expect(repo.update).toHaveBeenCalledWith('prop-1', {
        status: PropertyStatus.needs_revision,
        revisionCount: 2,
        revisionNotes: [existingNote, { adminId: 'admin-1', timestamp: now.toISOString(), items }],
      });
      jest.useRealTimers();
    });

    it('escalates instead of requesting another revision once the cycle cap is reached', async () => {
      const property = buildProperty({ revisionCount: 3 });
      repo.findById.mockResolvedValue(property);
      repo.update.mockResolvedValue(buildProperty({ status: PropertyStatus.escalated }));

      const result = await service.requestRevision('prop-1', 'admin-1', items);

      expect(repo.createModerationLog).toHaveBeenCalledWith({
        propertyId: 'prop-1',
        adminId: 'admin-1',
        action: ModerationAction.revision_requested,
        revisionItems: items,
      });
      expect(repo.update).toHaveBeenCalledWith('prop-1', { status: PropertyStatus.escalated });
      expect(events.emit).not.toHaveBeenCalledWith(
        DOMAIN_EVENTS.HOTEL_REVISION_REQUESTED,
        expect.anything(),
      );
      expect(result).toEqual({ propertyId: 'prop-1', status: PropertyStatus.escalated });
    });
  });
});

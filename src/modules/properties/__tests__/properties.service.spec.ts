import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import {
  BookingPolicy,
  BusinessEntity,
  DocumentStatus,
  DocumentType,
  Property,
  PropertyCategory,
  PropertyStatus,
  PropertyType,
  RoomTypeCategory,
} from '@prisma/client';
import { DOMAIN_EVENTS } from '../../../common/events/domain-events';
import { ComplianceSummary } from '../compliance/compliance.service';
import { PropertiesService } from '../properties.service';

const now = new Date('2026-06-11T00:00:00.000Z');

function buildProperty(overrides: Partial<Property> = {}): Property {
  return {
    id: 'prop-1',
    name: 'Untitled property',
    ownerId: 'owner-1',
    createdAt: now,
    updatedAt: now,
    status: PropertyStatus.draft,
    draftStep: null,
    draftData: null,
    submissionRef: null,
    submittedAt: null,
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

const step1Hourly = {
  propertyName: 'Sunrise Hotel',
  propertyType: PropertyType.hotel,
  bookingPolicy: BookingPolicy.hourly,
  businessEntity: BusinessEntity.individual,
  ownerFirstName: 'Ravi',
  ownerLastName: 'Kumar',
  category: PropertyCategory.mid,
};

const step2 = {
  latitude: 12.9716,
  longitude: 77.5946,
  addressLine1: '123 MG Road area',
  addressLine2: 'Near central park, opposite the mall',
  pincode: '560001',
  city: 'Bengaluru',
  state: 'Karnataka',
};

const houseRules = {
  couple_friendly: 'yes',
  pet_friendly: 'no',
  party_allowed: 'no',
  alcohol_allowed: 'not_allowed',
  smoking_allowed: 'no',
  bachelor_groups: 'yes',
  id_proof_required: 'yes',
  outside_food: 'on_request',
};

const step3Hourly = {
  rooms: [
    { type: RoomTypeCategory.ac, count: 2, hourlyRate: 500, maxOccupancy: 2 },
    { type: RoomTypeCategory.nonac, count: 0 },
  ],
  minBookingHours: '2',
  amenities: ['WiFi'],
  houseRules,
};

const step4 = {
  photos: [{ category: 'exterior', url: 'https://example.com/1.jpg' }],
};

const complianceSummary: ComplianceSummary = {
  legalBusinessName: 'Sunrise Hospitality',
  gstinMasked: '29***********3Z5',
  panMasked: '*****1234F',
  bankAccountNumberMasked: '*****6789',
  ifsc: 'HDFC0000123',
  accountHolderName: 'Ravi Kumar',
  documents: [{ type: DocumentType.fire_safety_cert, status: DocumentStatus.pending, expiresAt: null }],
};

function fullDraftData(overrides: Record<string, unknown> = {}) {
  return {
    step1: step1Hourly,
    step2,
    step3: step3Hourly,
    step4,
    ...overrides,
  };
}

describe(PropertiesService.name, () => {
  const repo = {
    create: jest.fn(),
    findById: jest.fn(),
    update: jest.fn(),
    createOwnerRole: jest.fn(),
    replaceRoomTypes: jest.fn(),
    replacePhotos: jest.fn(),
    generateSubmissionRef: jest.fn(),
  };
  const compliance = {
    saveStep5: jest.fn(),
    getSummary: jest.fn(),
  };
  const events = {
    emit: jest.fn(),
    on: jest.fn(),
  };

  let service: PropertiesService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new PropertiesService(repo as never, compliance as never, events as never);
    repo.replaceRoomTypes.mockResolvedValue(undefined);
    repo.replacePhotos.mockResolvedValue(undefined);
  });

  describe('createDraft', () => {
    it('creates a property and grants the caller OWNER on it', async () => {
      repo.create.mockResolvedValue(buildProperty({ id: 'prop-1' }));
      repo.createOwnerRole.mockResolvedValue(undefined);

      const result = await service.createDraft('owner-1');

      expect(repo.create).toHaveBeenCalledWith(
        expect.objectContaining({ name: 'Untitled property', ownerId: 'owner-1', status: PropertyStatus.draft }),
      );
      expect(repo.createOwnerRole).toHaveBeenCalledWith('owner-1', 'prop-1');
      expect(result).toEqual({ propertyId: 'prop-1' });
    });
  });

  describe('getDraft', () => {
    it('throws NotFoundException for an unknown property', async () => {
      repo.findById.mockResolvedValue(null);
      await expect(service.getDraft('missing')).rejects.toThrow(NotFoundException);
    });

    it('returns the draft state with the compliance summary', async () => {
      const property = buildProperty({ draftStep: 2, draftData: { step1: step1Hourly } });
      repo.findById.mockResolvedValue(property);
      compliance.getSummary.mockResolvedValue(null);

      const result = await service.getDraft('prop-1');

      expect(result).toEqual({
        propertyId: 'prop-1',
        status: PropertyStatus.draft,
        draftStep: 2,
        draftData: { step1: step1Hourly },
        compliance: null,
      });
    });
  });

  describe('saveStep', () => {
    it('rejects an out-of-range step number', async () => {
      repo.findById.mockResolvedValue(buildProperty());
      await expect(service.saveStep('prop-1', 6, {})).rejects.toThrow(BadRequestException);
    });

    it('rejects edits while the property is pending review', async () => {
      repo.findById.mockResolvedValue(buildProperty({ status: PropertyStatus.pending_review }));
      await expect(service.saveStep('prop-1', 1, step1Hourly)).rejects.toThrow(ConflictException);
    });

    it('saves step 1 and syncs the canonical name column', async () => {
      const property = buildProperty();
      repo.findById.mockResolvedValue(property);
      repo.update.mockResolvedValue(
        buildProperty({ draftStep: 1, draftData: { step1: step1Hourly }, name: step1Hourly.propertyName }),
      );

      const result = await service.saveStep('prop-1', 1, step1Hourly);

      expect(repo.update).toHaveBeenCalledWith(
        'prop-1',
        expect.objectContaining({
          name: step1Hourly.propertyName,
          draftStep: 1,
          draftData: expect.objectContaining({ step1: expect.objectContaining(step1Hourly) }),
        }),
      );
      expect(result.draftStep).toBe(1);
    });

    it('rejects step 1 with an invalid propertyType', async () => {
      repo.findById.mockResolvedValue(buildProperty());
      await expect(
        service.saveStep('prop-1', 1, { ...step1Hourly, propertyType: 'castle' }),
      ).rejects.toMatchObject({
        response: expect.objectContaining({ step: 1 }),
      });
    });

    it('rejects step 3 when no room type has a count > 0', async () => {
      repo.findById.mockResolvedValue(buildProperty());
      const payload = { ...step3Hourly, rooms: [{ type: RoomTypeCategory.ac, count: 0 }] };

      await expect(service.saveStep('prop-1', 3, payload)).rejects.toMatchObject({
        response: expect.objectContaining({
          step: 3,
          errors: [expect.objectContaining({ field: 'rooms' })],
        }),
      });
    });

    it('rejects step 4 when a category has more than 10 photos', async () => {
      repo.findById.mockResolvedValue(buildProperty());
      const photos = Array.from({ length: 11 }, (_, i) => ({
        category: 'exterior',
        url: `https://example.com/${i}.jpg`,
      }));

      await expect(service.saveStep('prop-1', 4, { photos })).rejects.toMatchObject({
        response: expect.objectContaining({ step: 4 }),
      });
    });

    it('delegates step 5 to the compliance service', async () => {
      const property = buildProperty();
      repo.findById.mockResolvedValue(property);
      compliance.saveStep5.mockResolvedValue(complianceSummary);
      repo.update.mockResolvedValue(buildProperty({ draftStep: 5 }));

      const step5Body = {
        gstin: '29ABCDE1234F1Z5',
        legalBusinessName: 'Sunrise Hospitality',
        pan: 'ABCDE1234F',
        bankAccountNumber: '123456789012',
        ifsc: 'HDFC0000123',
        accountHolderName: 'Ravi Kumar',
        tcAccepted: true,
        formCAcknowledged: true,
      };

      const result = await service.saveStep('prop-1', 5, step5Body);

      expect(compliance.saveStep5).toHaveBeenCalledWith('prop-1', expect.objectContaining(step5Body));
      expect(result.compliance).toBe(complianceSummary);
      expect(repo.update).toHaveBeenCalledWith('prop-1', { draftStep: 5 });
    });
  });

  describe('submit', () => {
    it('rejects properties that are not in draft', async () => {
      repo.findById.mockResolvedValue(buildProperty({ status: PropertyStatus.pending_review }));
      await expect(service.submit('prop-1')).rejects.toThrow(ConflictException);
    });

    it('rejects when an earlier step is missing from draftData', async () => {
      repo.findById.mockResolvedValue(buildProperty({ draftData: fullDraftData({ step2: undefined }) }));
      await expect(service.submit('prop-1')).rejects.toMatchObject({
        response: expect.objectContaining({ step: 2 }),
      });
    });

    it('rejects when step 5 (compliance) is incomplete', async () => {
      repo.findById.mockResolvedValue(buildProperty({ draftData: fullDraftData() }));
      compliance.getSummary.mockResolvedValue(null);

      await expect(service.submit('prop-1')).rejects.toMatchObject({
        response: expect.objectContaining({ step: 5 }),
      });
    });

    it('rejects when minBookingHours is missing for a non-fullday booking policy', async () => {
      repo.findById.mockResolvedValue(
        buildProperty({
          draftData: fullDraftData({ step3: { ...step3Hourly, minBookingHours: undefined } }),
        }),
      );
      compliance.getSummary.mockResolvedValue(complianceSummary);

      await expect(service.submit('prop-1')).rejects.toMatchObject({
        response: expect.objectContaining({
          step: 3,
          errors: [expect.objectContaining({ field: 'minBookingHours' })],
        }),
      });
    });

    it('rejects when a counted room is missing the rate required by the booking policy', async () => {
      repo.findById.mockResolvedValue(
        buildProperty({
          draftData: fullDraftData({
            step3: {
              ...step3Hourly,
              rooms: [{ type: RoomTypeCategory.ac, count: 1, maxOccupancy: 2 }],
            },
          }),
        }),
      );
      compliance.getSummary.mockResolvedValue(complianceSummary);

      await expect(service.submit('prop-1')).rejects.toMatchObject({
        response: expect.objectContaining({
          step: 3,
          errors: [expect.objectContaining({ field: 'rooms[0].hourlyRate' })],
        }),
      });
    });

    it('rejects banquet properties without a seatingCapacity', async () => {
      repo.findById.mockResolvedValue(
        buildProperty({
          draftData: fullDraftData({
            step1: { ...step1Hourly, propertyType: PropertyType.banquet },
          }),
        }),
      );
      compliance.getSummary.mockResolvedValue(complianceSummary);

      await expect(service.submit('prop-1')).rejects.toMatchObject({
        response: expect.objectContaining({
          step: 3,
          errors: [expect.objectContaining({ field: 'seatingCapacity' })],
        }),
      });
    });

    it('rejects when the fire safety certificate is missing', async () => {
      repo.findById.mockResolvedValue(buildProperty({ draftData: fullDraftData() }));
      compliance.getSummary.mockResolvedValue({ ...complianceSummary, documents: [] });

      await expect(service.submit('prop-1')).rejects.toMatchObject({
        response: expect.objectContaining({
          step: 5,
          errors: [expect.objectContaining({ constraints: ['Fire safety certificate is required'] })],
        }),
      });
    });

    it('rejects when amenities require FSSAI but no fssai_license document exists', async () => {
      repo.findById.mockResolvedValue(
        buildProperty({
          draftData: fullDraftData({
            step3: { ...step3Hourly, amenities: ['restaurant'] },
          }),
        }),
      );
      compliance.getSummary.mockResolvedValue(complianceSummary);

      await expect(service.submit('prop-1')).rejects.toMatchObject({
        response: expect.objectContaining({
          step: 5,
          errors: [expect.objectContaining({ constraints: ['FSSAI license is required for the selected amenities'] })],
        }),
      });
    });

    it('rejects when a GSTIN-required entity has no GSTIN on file', async () => {
      repo.findById.mockResolvedValue(
        buildProperty({
          draftData: fullDraftData({
            step1: { ...step1Hourly, businessEntity: BusinessEntity.partnership },
          }),
        }),
      );
      // Partnership needs a GSTIN AND a partnership_deed; provide the deed so
      // the GSTIN error is isolated.
      compliance.getSummary.mockResolvedValue({
        ...complianceSummary,
        gstinMasked: null,
        documents: [
          { type: DocumentType.fire_safety_cert, status: DocumentStatus.pending, expiresAt: null },
          { type: DocumentType.partnership_deed, status: DocumentStatus.pending, expiresAt: null },
        ],
      });

      await expect(service.submit('prop-1')).rejects.toMatchObject({
        response: expect.objectContaining({
          step: 5,
          errors: [expect.objectContaining({ field: 'gstin' })],
        }),
      });
    });

    it('allows an individual entity with no GSTIN on file', async () => {
      jest.useFakeTimers().setSystemTime(now);
      repo.findById.mockResolvedValue(
        buildProperty({ draftData: fullDraftData(), draftStep: 5 }),
      );
      compliance.getSummary.mockResolvedValue({ ...complianceSummary, gstinMasked: null });
      repo.generateSubmissionRef.mockResolvedValue('PPH-2026-00002');
      repo.update.mockResolvedValue(
        buildProperty({ status: PropertyStatus.pending_review, bookingPolicy: BookingPolicy.hourly }),
      );

      await expect(service.submit('prop-1')).resolves.toMatchObject({
        status: PropertyStatus.pending_review,
      });
      jest.useRealTimers();
    });

    it('rejects an llp entity missing its entity documents', async () => {
      repo.findById.mockResolvedValue(
        buildProperty({
          draftData: fullDraftData({
            step1: { ...step1Hourly, businessEntity: BusinessEntity.llp },
          }),
        }),
      );
      // GSTIN present so only the entity-document errors surface.
      compliance.getSummary.mockResolvedValue(complianceSummary);

      await expect(service.submit('prop-1')).rejects.toMatchObject({
        response: expect.objectContaining({
          step: 5,
          errors: expect.arrayContaining([
            expect.objectContaining({
              constraints: ['LLP agreement is required for llp entities'],
            }),
            expect.objectContaining({
              constraints: ['Certificate of incorporation is required for llp entities'],
            }),
          ]),
        }),
      });
    });

    it('materializes room types/photos, marks the property pending_review, and emits the event', async () => {
      jest.useFakeTimers().setSystemTime(now);
      const property = buildProperty({ draftData: fullDraftData(), draftStep: 5 });
      repo.findById.mockResolvedValue(property);
      compliance.getSummary.mockResolvedValue(complianceSummary);
      repo.generateSubmissionRef.mockResolvedValue('PPH-2026-00001');
      repo.update.mockResolvedValue(
        buildProperty({
          status: PropertyStatus.pending_review,
          submissionRef: 'PPH-2026-00001',
          submittedAt: now,
          bookingPolicy: BookingPolicy.hourly,
        }),
      );

      const result = await service.submit('prop-1');

      expect(repo.update).toHaveBeenCalledWith(
        'prop-1',
        expect.objectContaining({
          status: PropertyStatus.pending_review,
          submissionRef: 'PPH-2026-00001',
          draftStep: null,
          name: step1Hourly.propertyName,
          businessEntity: BusinessEntity.individual,
          minBookingHours: 2,
          defaultCheckinTime: '12:00',
          defaultCheckoutTime: '11:00',
        }),
      );
      expect(repo.replaceRoomTypes).toHaveBeenCalledWith('prop-1', [
        {
          type: RoomTypeCategory.ac,
          count: 2,
          hourlyRatePaise: 50000,
          fulldayRatePaise: null,
          maxOccupancy: 2,
        },
      ]);
      expect(repo.replacePhotos).toHaveBeenCalledWith('prop-1', [
        { category: 'exterior', url: 'https://example.com/1.jpg', isPrimary: false, sortOrder: 0 },
      ]);
      expect(events.emit).toHaveBeenCalledWith(DOMAIN_EVENTS.HOTEL_ONBOARDING_SUBMITTED, {
        hotelId: 'prop-1',
        ownerId: 'owner-1',
        bookingMode: 'hourly',
        submissionRef: 'PPH-2026-00001',
      });
      expect(result).toEqual({
        propertyId: 'prop-1',
        status: PropertyStatus.pending_review,
        submissionRef: 'PPH-2026-00001',
        submittedAt: now,
      });
      jest.useRealTimers();
    });
  });

  describe('revise', () => {
    it('rejects properties that are not needs_revision', async () => {
      repo.findById.mockResolvedValue(buildProperty({ status: PropertyStatus.draft }));
      await expect(service.revise('prop-1')).rejects.toThrow(ConflictException);
    });

    it('resubmits without generating a new submissionRef or touching revisionCount', async () => {
      const property = buildProperty({
        status: PropertyStatus.needs_revision,
        submissionRef: 'PPH-2026-00001',
        revisionCount: 1,
        draftData: fullDraftData(),
      });
      repo.findById.mockResolvedValue(property);
      compliance.getSummary.mockResolvedValue(complianceSummary);
      repo.update.mockResolvedValue(
        buildProperty({
          status: PropertyStatus.pending_review,
          submissionRef: 'PPH-2026-00001',
          submittedAt: now,
          revisionCount: 1,
          bookingPolicy: BookingPolicy.hourly,
        }),
      );

      const result = await service.revise('prop-1');

      expect(repo.generateSubmissionRef).not.toHaveBeenCalled();
      expect(repo.update).toHaveBeenCalledWith(
        'prop-1',
        expect.objectContaining({ status: PropertyStatus.pending_review, draftStep: null }),
      );
      expect(repo.update.mock.calls[0][1]).not.toHaveProperty('submissionRef');
      expect(repo.update.mock.calls[0][1]).not.toHaveProperty('revisionCount');
      expect(events.emit).toHaveBeenCalledWith(
        DOMAIN_EVENTS.HOTEL_ONBOARDING_SUBMITTED,
        expect.objectContaining({ submissionRef: 'PPH-2026-00001' }),
      );
      expect(result.submissionRef).toBe('PPH-2026-00001');
    });
  });

  describe('getStatus', () => {
    it('returns a pending timeline for a draft that has not been submitted', async () => {
      repo.findById.mockResolvedValue(buildProperty());

      const result = await service.getStatus('prop-1');

      expect(result.timeline).toEqual([
        { label: 'Submitted', status: 'pending', at: null },
        { label: 'Under Review', status: 'pending', at: null },
        { label: 'Decision', status: 'pending', at: null },
        { label: 'Live', status: 'pending', at: null },
      ]);
    });

    it('marks the review step current while pending_review', async () => {
      repo.findById.mockResolvedValue(
        buildProperty({ status: PropertyStatus.pending_review, submittedAt: now, submissionRef: 'PPH-2026-00001' }),
      );

      const result = await service.getStatus('prop-1');

      expect(result.timeline[0]).toEqual({ label: 'Submitted', status: 'done', at: now });
      expect(result.timeline[1]).toEqual({ label: 'Under Review', status: 'current', at: now });
      expect(result.timeline[2].status).toBe('pending');
      expect(result.timeline[3].status).toBe('pending');
    });

    it('marks Decision and Live done once approved and active', async () => {
      repo.findById.mockResolvedValue(
        buildProperty({
          status: PropertyStatus.approved,
          submittedAt: now,
          submissionRef: 'PPH-2026-00001',
          isActive: true,
        }),
      );

      const result = await service.getStatus('prop-1');

      expect(result.timeline[1]).toEqual({ label: 'Under Review', status: 'done', at: now });
      expect(result.timeline[2]).toEqual({ label: 'Decision', status: 'done', at: now });
      expect(result.timeline[3]).toEqual({ label: 'Live', status: 'done', at: now });
    });
  });
});

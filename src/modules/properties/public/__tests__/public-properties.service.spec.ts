import { BadRequestException, NotFoundException } from '@nestjs/common';
import {
  BookingPolicy,
  Property,
  PropertyCategory,
  PropertyPhoto,
  PropertyStatus,
  PropertyType,
  RoomType,
  RoomTypeCategory,
} from '@prisma/client';
import { PublicPropertiesService } from '../public-properties.service';
import { ListPublicPropertiesQueryDto } from '../dto/list-public-properties-query.dto';

function buildQuery(overrides: Partial<ListPublicPropertiesQueryDto> = {}): ListPublicPropertiesQueryDto {
  return Object.assign(new ListPublicPropertiesQueryDto(), { page: 1, limit: 20, ...overrides });
}

const now = new Date('2026-06-11T00:00:00.000Z');

function buildProperty(overrides: Partial<Property> = {}): Property {
  return {
    id: 'prop-1',
    name: 'PayPerHour Demo Suites',
    ownerId: 'owner-1',
    createdAt: now,
    updatedAt: now,
    status: PropertyStatus.approved,
    draftStep: null,
    draftData: null,
    submissionRef: 'PPH-2026-DEMO1',
    submittedAt: now,
    revisionCount: 0,
    revisionNotes: null,
    propertyType: PropertyType.hotel,
    bookingPolicy: BookingPolicy.both,
    category: PropertyCategory.mid,
    description: 'A comfortable demo property.',
    ownerFirstName: null,
    ownerMiddleName: null,
    ownerLastName: null,
    addressLine1: '123 MG Road',
    addressLine2: null,
    city: 'Bangalore',
    state: 'Karnataka',
    pincode: '560001',
    landmark: 'Koramangala',
    specialNote: null,
    latitude: null,
    longitude: null,
    amenities: ['WiFi', 'AC'],
    houseRules: null,
    minBookingHours: 3,
    defaultCheckinTime: '12:00',
    defaultCheckoutTime: '11:00',
    seatingCapacity: null,
    deletionRequestedAt: null,
    deletionScheduledFor: null,
    deletionTrack: null,
    isActive: true,
    ...overrides,
  } as Property;
}

function buildRoomType(overrides: Partial<RoomType> = {}): RoomType {
  return {
    id: 'room-1',
    propertyId: 'prop-1',
    type: RoomTypeCategory.ac,
    count: 2,
    hourlyRatePaise: 80000,
    fulldayRatePaise: 500000,
    maxOccupancy: 4,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  } as RoomType;
}

function buildPhoto(overrides: Partial<PropertyPhoto> = {}): PropertyPhoto {
  return {
    id: 'photo-1',
    propertyId: 'prop-1',
    category: 'exterior',
    url: 'https://example.com/photo.jpg',
    isPrimary: true,
    sortOrder: 0,
    createdAt: now,
    ...overrides,
  } as PropertyPhoto;
}

describe(PublicPropertiesService.name, () => {
  const repo = {
    searchApproved: jest.fn(),
    findManyByIdsOrdered: jest.fn(),
    findApprovedById: jest.fn(),
    findRoomTypes: jest.fn(),
    findPhotos: jest.fn(),
    findRoomTypesForProperties: jest.fn(),
    findPrimaryPhotosForProperties: jest.fn(),
  };

  let service: PublicPropertiesService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new PublicPropertiesService(repo as never);
  });

  describe('list', () => {
    it('paginates approved properties and attaches starting prices + primary photo', async () => {
      repo.searchApproved.mockResolvedValue({ ids: ['prop-1'], total: 1 });
      repo.findManyByIdsOrdered.mockResolvedValue([buildProperty()]);
      repo.findRoomTypesForProperties.mockResolvedValue([
        buildRoomType({ type: RoomTypeCategory.ac, hourlyRatePaise: 80000, fulldayRatePaise: 500000 }),
        buildRoomType({
          id: 'room-2',
          type: RoomTypeCategory.nonac,
          hourlyRatePaise: 50000,
          fulldayRatePaise: 350000,
        }),
      ]);
      repo.findPrimaryPhotosForProperties.mockResolvedValue([buildPhoto()]);

      const result = await service.list(buildQuery());

      expect(repo.searchApproved).toHaveBeenCalledWith(
        expect.objectContaining({ skip: 0, take: 20, sort: 'newest' }),
      );
      expect(repo.findManyByIdsOrdered).toHaveBeenCalledWith(['prop-1']);
      expect(repo.findRoomTypesForProperties).toHaveBeenCalledWith(['prop-1']);
      expect(repo.findPrimaryPhotosForProperties).toHaveBeenCalledWith(['prop-1']);
      expect(result).toEqual({
        items: [
          expect.objectContaining({
            id: 'prop-1',
            name: 'PayPerHour Demo Suites',
            city: 'Bangalore',
            area: 'Koramangala',
            primaryImageUrl: 'https://example.com/photo.jpg',
            startingHourlyRatePaise: 50000,
            startingFulldayRatePaise: 350000,
          }),
        ],
        total: 1,
        page: 1,
        limit: 20,
      });
    });

    it('returns null prices and photo when a property has no room types or photos', async () => {
      repo.searchApproved.mockResolvedValue({ ids: ['prop-1'], total: 1 });
      repo.findManyByIdsOrdered.mockResolvedValue([buildProperty()]);
      repo.findRoomTypesForProperties.mockResolvedValue([]);
      repo.findPrimaryPhotosForProperties.mockResolvedValue([]);

      const result = await service.list(buildQuery());

      expect(result.items[0]).toEqual(
        expect.objectContaining({
          primaryImageUrl: null,
          startingHourlyRatePaise: null,
          startingFulldayRatePaise: null,
        }),
      );
    });

    it('applies pagination offsets for page > 1', async () => {
      repo.searchApproved.mockResolvedValue({ ids: [], total: 0 });
      repo.findManyByIdsOrdered.mockResolvedValue([]);
      repo.findRoomTypesForProperties.mockResolvedValue([]);
      repo.findPrimaryPhotosForProperties.mockResolvedValue([]);

      await service.list(buildQuery({ page: 3, limit: 10 }));

      expect(repo.searchApproved).toHaveBeenCalledWith(expect.objectContaining({ skip: 20, take: 10 }));
    });

    it('passes through q/city/amenities/price filters and defaults sort to relevance when q is set', async () => {
      repo.searchApproved.mockResolvedValue({ ids: [], total: 0 });
      repo.findManyByIdsOrdered.mockResolvedValue([]);

      await service.list(
        buildQuery({
          q: 'koramangala',
          city: 'Bangalore',
          amenities: 'WiFi, AC',
          minPrice: 50000,
          maxPrice: 100000,
        }),
      );

      expect(repo.searchApproved).toHaveBeenCalledWith(
        expect.objectContaining({
          q: 'koramangala',
          city: 'Bangalore',
          amenities: ['WiFi', 'AC'],
          minPricePaise: 50000,
          maxPricePaise: 100000,
          sort: 'relevance',
        }),
      );
    });

    it('ignores the rating param entirely (no Reviews module yet)', async () => {
      repo.searchApproved.mockResolvedValue({ ids: [], total: 0 });
      repo.findManyByIdsOrdered.mockResolvedValue([]);

      await service.list(buildQuery({ rating: '4' }));

      const callArgs = repo.searchApproved.mock.calls[0][0];
      expect(callArgs).not.toHaveProperty('rating');
    });

    it('computes the availability window from checkInAt + durationHours (hourly)', async () => {
      repo.searchApproved.mockResolvedValue({ ids: [], total: 0 });
      repo.findManyByIdsOrdered.mockResolvedValue([]);

      await service.list(
        buildQuery({ checkInAt: '2026-06-15T10:00:00.000Z', durationHours: 3 }),
      );

      expect(repo.searchApproved).toHaveBeenCalledWith(
        expect.objectContaining({
          availability: {
            checkInAt: new Date('2026-06-15T10:00:00.000Z'),
            checkOutAt: new Date('2026-06-15T13:00:00.000Z'),
          },
        }),
      );
    });

    it('uses a 24h availability window for fullday bookingType regardless of durationHours', async () => {
      repo.searchApproved.mockResolvedValue({ ids: [], total: 0 });
      repo.findManyByIdsOrdered.mockResolvedValue([]);

      await service.list(
        buildQuery({
          checkInAt: '2026-06-15T10:00:00.000Z',
          durationHours: 3,
          bookingType: 'fullday' as never,
        }),
      );

      expect(repo.searchApproved).toHaveBeenCalledWith(
        expect.objectContaining({
          availability: {
            checkInAt: new Date('2026-06-15T10:00:00.000Z'),
            checkOutAt: new Date('2026-06-16T10:00:00.000Z'),
          },
        }),
      );
    });

    it('throws BadRequestException when only checkInAt is provided', async () => {
      await expect(service.list(buildQuery({ checkInAt: '2026-06-15T10:00:00.000Z' }))).rejects.toThrow(
        BadRequestException,
      );
    });

    it('throws BadRequestException when only durationHours is provided', async () => {
      await expect(service.list(buildQuery({ durationHours: 3 }))).rejects.toThrow(BadRequestException);
    });

    it('respects an explicit sort even when q is set', async () => {
      repo.searchApproved.mockResolvedValue({ ids: [], total: 0 });
      repo.findManyByIdsOrdered.mockResolvedValue([]);

      await service.list(buildQuery({ q: 'demo', sort: 'price_asc' }));

      expect(repo.searchApproved).toHaveBeenCalledWith(expect.objectContaining({ sort: 'price_asc' }));
    });
  });

  describe('getById', () => {
    it('returns full detail with room types and photos', async () => {
      repo.findApprovedById.mockResolvedValue(buildProperty());
      repo.findRoomTypes.mockResolvedValue([buildRoomType()]);
      repo.findPhotos.mockResolvedValue([buildPhoto()]);

      const result = await service.getById('prop-1');

      expect(result).toEqual(
        expect.objectContaining({
          id: 'prop-1',
          addressLine1: '123 MG Road',
          state: 'Karnataka',
          pincode: '560001',
          roomTypes: [
            expect.objectContaining({ id: 'room-1', type: RoomTypeCategory.ac, hourlyRatePaise: 80000 }),
          ],
          photos: [expect.objectContaining({ url: 'https://example.com/photo.jpg', isPrimary: true })],
        }),
      );
    });

    it('throws NotFoundException when the property is not approved/active', async () => {
      repo.findApprovedById.mockResolvedValue(null);

      await expect(service.getById('prop-missing')).rejects.toThrow(NotFoundException);
    });

    it('falls back to the first photo when none is marked primary', async () => {
      repo.findApprovedById.mockResolvedValue(buildProperty());
      repo.findRoomTypes.mockResolvedValue([]);
      repo.findPhotos.mockResolvedValue([buildPhoto({ isPrimary: false, url: 'https://example.com/first.jpg' })]);

      const result = await service.getById('prop-1');

      expect(result.primaryImageUrl).toBe('https://example.com/first.jpg');
    });
  });
});

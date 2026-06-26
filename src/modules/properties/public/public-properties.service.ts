import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import {
  BookingPolicy,
  BookingType,
  Property,
  PropertyCategory,
  PropertyPhoto,
  PropertyType,
  RoomType,
  RoomTypeCategory,
} from '@prisma/client';
import { PropertiesRepository } from '../properties.repository';
import { ListPublicPropertiesQueryDto } from './dto/list-public-properties-query.dto';

const FULLDAY_DURATION_HOURS = 24;

export interface PublicPropertySummary {
  id: string;
  name: string;
  city: string | null;
  area: string | null;
  description: string | null;
  propertyType: PropertyType | null;
  category: PropertyCategory | null;
  bookingPolicy: BookingPolicy | null;
  amenities: string[];
  minBookingHours: number | null;
  primaryImageUrl: string | null;
  startingHourlyRatePaise: number | null;
  startingFulldayRatePaise: number | null;
}

export interface PublicRoomTypeView {
  id: string;
  type: RoomTypeCategory;
  count: number;
  hourlyRatePaise: number | null;
  fulldayRatePaise: number | null;
  maxOccupancy: number | null;
}

export interface PublicPhotoView {
  url: string;
  category: string;
  isPrimary: boolean;
}

export interface PublicPropertyDetail extends PublicPropertySummary {
  addressLine1: string | null;
  addressLine2: string | null;
  state: string | null;
  pincode: string | null;
  landmark: string | null;
  latitude: number | null;
  longitude: number | null;
  defaultCheckinTime: string | null;
  defaultCheckoutTime: string | null;
  roomTypes: PublicRoomTypeView[];
  photos: PublicPhotoView[];
}

export interface PublicPropertyListResult {
  items: PublicPropertySummary[];
  total: number;
  page: number;
  limit: number;
}

@Injectable()
export class PublicPropertiesService {
  constructor(private readonly repo: PropertiesRepository) {}

  /** GET /properties/public - approved + active properties for guest discovery (M4: search/filter/sort). */
  async list(query: ListPublicPropertiesQueryDto): Promise<PublicPropertyListResult> {
    const { page, limit } = query;

    if ((query.checkInAt == null) !== (query.durationHours == null)) {
      throw new BadRequestException('checkInAt and durationHours must be provided together.');
    }

    const amenities = query.amenities
      ? query.amenities.split(',').map((value) => value.trim()).filter(Boolean)
      : undefined;

    let availability: { checkInAt: Date; checkOutAt: Date } | undefined;
    if (query.checkInAt != null && query.durationHours != null) {
      const checkInAt = new Date(query.checkInAt);
      const durationHours =
        query.bookingType === BookingType.fullday ? FULLDAY_DURATION_HOURS : query.durationHours;
      const checkOutAt = new Date(checkInAt.getTime() + durationHours * 60 * 60 * 1000);
      availability = { checkInAt, checkOutAt };
    }

    const sort = query.sort ?? (query.q ? 'relevance' : 'newest');

    const { ids, total } = await this.repo.searchApproved({
      skip: (page - 1) * limit,
      take: limit,
      city: query.city,
      q: query.q?.trim() || undefined,
      amenities,
      minPricePaise: query.minPrice,
      maxPricePaise: query.maxPrice,
      availability,
      sort,
    });

    const items = await this.repo.findManyByIdsOrdered(ids);
    const propertyIds = items.map((property) => property.id);

    const [roomTypes, photos] = await Promise.all([
      this.repo.findRoomTypesForProperties(propertyIds),
      this.repo.findPrimaryPhotosForProperties(propertyIds),
    ]);

    const roomTypesByProperty = this.groupBy(roomTypes, (room) => room.propertyId);
    const photoByProperty = new Map(photos.map((photo) => [photo.propertyId, photo]));

    return {
      items: items.map((property) =>
        this.toSummary(
          property,
          roomTypesByProperty.get(property.id) ?? [],
          photoByProperty.get(property.id) ?? null,
        ),
      ),
      total,
      page,
      limit,
    };
  }

  /** GET /properties/public/:id - full detail with room types and photos. */
  async getById(propertyId: string): Promise<PublicPropertyDetail> {
    const property = await this.repo.findApprovedById(propertyId);
    if (!property) {
      throw new NotFoundException('Property not found');
    }

    const [roomTypes, photos] = await Promise.all([
      this.repo.findRoomTypes(propertyId),
      this.repo.findPhotos(propertyId),
    ]);

    const primaryPhoto = photos.find((photo) => photo.isPrimary) ?? photos[0] ?? null;

    return {
      ...this.toSummary(property, roomTypes, primaryPhoto),
      addressLine1: property.addressLine1,
      addressLine2: property.addressLine2,
      state: property.state,
      pincode: property.pincode,
      landmark: property.landmark,
      latitude: property.latitude != null ? Number(property.latitude) : null,
      longitude: property.longitude != null ? Number(property.longitude) : null,
      defaultCheckinTime: property.defaultCheckinTime,
      defaultCheckoutTime: property.defaultCheckoutTime,
      roomTypes: roomTypes.map((room) => ({
        id: room.id,
        type: room.type,
        count: room.count,
        hourlyRatePaise: room.hourlyRatePaise,
        fulldayRatePaise: room.fulldayRatePaise,
        maxOccupancy: room.maxOccupancy,
      })),
      photos: photos.map((photo) => ({
        url: photo.url,
        category: photo.category,
        isPrimary: photo.isPrimary,
      })),
    };
  }

  private toSummary(
    property: Property,
    roomTypes: RoomType[],
    primaryPhoto: PropertyPhoto | null,
  ): PublicPropertySummary {
    const hourlyRates = roomTypes
      .map((room) => room.hourlyRatePaise)
      .filter((rate): rate is number => rate != null);
    const fulldayRates = roomTypes
      .map((room) => room.fulldayRatePaise)
      .filter((rate): rate is number => rate != null);

    return {
      id: property.id,
      name: property.name,
      city: property.city,
      area: property.landmark,
      description: property.description,
      propertyType: property.propertyType,
      category: property.category,
      bookingPolicy: property.bookingPolicy,
      amenities: property.amenities,
      minBookingHours: property.minBookingHours,
      primaryImageUrl: primaryPhoto?.url ?? null,
      startingHourlyRatePaise: hourlyRates.length > 0 ? Math.min(...hourlyRates) : null,
      startingFulldayRatePaise: fulldayRates.length > 0 ? Math.min(...fulldayRates) : null,
    };
  }

  private groupBy<T, K>(items: T[], keyFn: (item: T) => K): Map<K, T[]> {
    const map = new Map<K, T[]>();
    for (const item of items) {
      const key = keyFn(item);
      const group = map.get(key);
      if (group) {
        group.push(item);
      } else {
        map.set(key, [item]);
      }
    }
    return map;
  }
}

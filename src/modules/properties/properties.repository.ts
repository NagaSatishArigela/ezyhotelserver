import { Injectable } from '@nestjs/common';
import {
  ModerationAction,
  Prisma,
  Property,
  PropertyModerationLog,
  PropertyPhoto,
  PropertyRole,
  PropertyStatus,
  RoomType,
} from '@prisma/client';
import { PrismaService } from '../database/prisma.service';

export type PublicPropertySort = 'relevance' | 'price_asc' | 'price_desc' | 'newest';

export interface PublicPropertySearchParams {
  skip: number;
  take: number;
  city?: string;
  q?: string;
  amenities?: string[];
  minPricePaise?: number;
  maxPricePaise?: number;
  availability?: { checkInAt: Date; checkOutAt: Date };
  sort: PublicPropertySort;
}

const ACTIVE_BOOKING_STATUSES = ['pending_payment', 'confirmed', 'checked_in'];

/** Escapes ILIKE wildcard characters so user input is matched literally. */
function escapeLikePattern(value: string): string {
  return value.replace(/[\\%_]/g, (char) => `\\${char}`);
}

@Injectable()
export class PropertiesRepository {
  constructor(private readonly prisma: PrismaService) {}

  create(data: Prisma.PropertyCreateInput): Promise<Property> {
    return this.prisma.property.create({ data });
  }

  findById(id: string): Promise<Property | null> {
    return this.prisma.property.findUnique({ where: { id } });
  }

  update(id: string, data: Prisma.PropertyUpdateInput): Promise<Property> {
    return this.prisma.property.update({ where: { id }, data });
  }

  /** GET /admin/properties - moderation queue, paginated by status. */
  async findManyByStatus(
    status: PropertyStatus,
    skip: number,
    take: number,
  ): Promise<{ items: Property[]; total: number }> {
    const [items, total] = await this.prisma.$transaction([
      this.prisma.property.findMany({
        where: { status },
        orderBy: { submittedAt: 'asc' },
        skip,
        take,
      }),
      this.prisma.property.count({ where: { status } }),
    ]);
    return { items, total };
  }

  findRoomTypes(propertyId: string): Promise<RoomType[]> {
    return this.prisma.roomType.findMany({ where: { propertyId } });
  }

  findPhotos(propertyId: string): Promise<PropertyPhoto[]> {
    return this.prisma.propertyPhoto.findMany({ where: { propertyId } });
  }

  /** Public property discovery (guest-facing) - approved + active only. */
  async findManyApproved(skip: number, take: number): Promise<{ items: Property[]; total: number }> {
    const where: Prisma.PropertyWhereInput = { status: PropertyStatus.approved, isActive: true };
    const [items, total] = await this.prisma.$transaction([
      this.prisma.property.findMany({ where, orderBy: { createdAt: 'desc' }, skip, take }),
      this.prisma.property.count({ where }),
    ]);
    return { items, total };
  }

  findApprovedById(id: string): Promise<Property | null> {
    return this.prisma.property.findFirst({
      where: { id, status: PropertyStatus.approved, isActive: true },
    });
  }

  /**
   * Public property search/discovery (M4): filterable, sortable, optionally
   * availability-aware. Implemented via raw SQL because price-range and
   * availability filters require aggregating `properties.room_types` and
   * `bookings.bookings`, which have no Prisma relation to `Property` per the
   * modular-monolith schema-isolation rule. Returns ids in final order;
   * callers re-fetch full rows and must preserve this order.
   */
  async searchApproved(params: PublicPropertySearchParams): Promise<{ ids: string[]; total: number }> {
    const conditions: Prisma.Sql[] = [
      Prisma.sql`p.status = 'approved' AND p.is_active = true`,
    ];

    if (params.city) {
      conditions.push(Prisma.sql`lower(p.city) = lower(${params.city})`);
    }

    if (params.amenities && params.amenities.length > 0) {
      conditions.push(Prisma.sql`p.amenities @> ${params.amenities}::text[]`);
    }

    if (params.q) {
      const pattern = `%${escapeLikePattern(params.q)}%`;
      conditions.push(Prisma.sql`(
        p.name ILIKE ${pattern}
        OR coalesce(p.description, '') ILIKE ${pattern}
        OR coalesce(p.landmark, '') ILIKE ${pattern}
        OR coalesce(p.city, '') ILIKE ${pattern}
      )`);
    }

    if (params.minPricePaise != null) {
      conditions.push(Prisma.sql`r.min_hourly_rate_paise >= ${params.minPricePaise}`);
    }

    if (params.maxPricePaise != null) {
      conditions.push(Prisma.sql`r.min_hourly_rate_paise <= ${params.maxPricePaise}`);
    }

    if (params.availability) {
      const { checkInAt, checkOutAt } = params.availability;
      conditions.push(Prisma.sql`EXISTS (
        SELECT 1 FROM properties.room_types rt
        WHERE rt.property_id = p.id
        AND rt.count > (
          SELECT COUNT(*)::int FROM bookings.bookings b
          WHERE b.room_type_id = rt.id
          AND b.status::text IN (${Prisma.join(ACTIVE_BOOKING_STATUSES)})
          AND b.check_in_at < ${checkOutAt}
          AND b.check_out_at > ${checkInAt}
        )
      )`);
    }

    const where = Prisma.join(conditions, ' AND ');
    const from = Prisma.sql`
      FROM properties.properties p
      LEFT JOIN (
        SELECT property_id, MIN(hourly_rate_paise) AS min_hourly_rate_paise
        FROM properties.room_types
        WHERE hourly_rate_paise IS NOT NULL
        GROUP BY property_id
      ) r ON r.property_id = p.id
    `;

    let orderBy: Prisma.Sql;
    if (params.sort === 'relevance' && params.q) {
      orderBy = Prisma.sql`ORDER BY GREATEST(
        similarity(p.name, ${params.q}),
        similarity(coalesce(p.description, ''), ${params.q}),
        similarity(coalesce(p.landmark, ''), ${params.q}),
        similarity(coalesce(p.city, ''), ${params.q})
      ) DESC, p.created_at DESC`;
    } else if (params.sort === 'price_asc') {
      orderBy = Prisma.sql`ORDER BY r.min_hourly_rate_paise ASC NULLS LAST, p.created_at DESC`;
    } else if (params.sort === 'price_desc') {
      orderBy = Prisma.sql`ORDER BY r.min_hourly_rate_paise DESC NULLS LAST, p.created_at DESC`;
    } else {
      orderBy = Prisma.sql`ORDER BY p.created_at DESC`;
    }

    const [rows, countRows] = await Promise.all([
      this.prisma.$queryRaw<Array<{ id: string }>>(Prisma.sql`
        SELECT p.id ${from} WHERE ${where} ${orderBy} LIMIT ${params.take} OFFSET ${params.skip}
      `),
      this.prisma.$queryRaw<Array<{ count: bigint }>>(Prisma.sql`
        SELECT COUNT(*) AS count ${from} WHERE ${where}
      `),
    ]);

    return { ids: rows.map((row) => row.id), total: Number(countRows[0]?.count ?? 0) };
  }

  /** Fetches properties by id, preserving the given order (e.g. search relevance/sort order). */
  async findManyByIdsOrdered(ids: string[]): Promise<Property[]> {
    if (ids.length === 0) return [];
    const properties = await this.prisma.property.findMany({ where: { id: { in: ids } } });
    const byId = new Map(properties.map((property) => [property.id, property]));
    return ids.map((id) => byId.get(id)).filter((property): property is Property => property != null);
  }

  findRoomTypesForProperties(propertyIds: string[]): Promise<RoomType[]> {
    return this.prisma.roomType.findMany({ where: { propertyId: { in: propertyIds } } });
  }

  findPrimaryPhotosForProperties(propertyIds: string[]): Promise<PropertyPhoto[]> {
    return this.prisma.propertyPhoto.findMany({
      where: { propertyId: { in: propertyIds }, isPrimary: true },
    });
  }

  /** M2B audit trail - one row per approve/reject/request-revision action. */
  createModerationLog(data: {
    propertyId: string;
    adminId: string;
    action: ModerationAction;
    reason?: string | null;
    revisionItems?: Prisma.InputJsonValue;
  }): Promise<PropertyModerationLog> {
    return this.prisma.propertyModerationLog.create({ data });
  }

  // Cross-schema write (auth.user_property_roles): grants the draft creator
  // OWNER on their new property. No Prisma relation/FK - plain UUID columns,
  // same pattern as PropertyRoleGuard's existing cross-schema reads.
  createOwnerRole(userId: string, propertyId: string): Promise<unknown> {
    return this.prisma.userPropertyRole.create({
      data: { userId, propertyId, role: PropertyRole.OWNER },
    });
  }

  /**
   * Replaces all RoomType rows for a property (full replace - simplest
   * correct semantics for resubmission after `needs_revision`).
   */
  async replaceRoomTypes(
    propertyId: string,
    rooms: Array<Omit<Prisma.RoomTypeCreateManyInput, 'propertyId'>>,
  ): Promise<void> {
    await this.prisma.$transaction([
      this.prisma.roomType.deleteMany({ where: { propertyId } }),
      ...(rooms.length > 0
        ? [
            this.prisma.roomType.createMany({
              data: rooms.map((room) => ({ ...room, propertyId })),
            }),
          ]
        : []),
    ]);
  }

  /** Replaces all PropertyPhoto rows for a property (full replace). */
  async replacePhotos(
    propertyId: string,
    photos: Array<Omit<Prisma.PropertyPhotoCreateManyInput, 'propertyId'>>,
  ): Promise<void> {
    await this.prisma.$transaction([
      this.prisma.propertyPhoto.deleteMany({ where: { propertyId } }),
      ...(photos.length > 0
        ? [
            this.prisma.propertyPhoto.createMany({
              data: photos.map((photo) => ({ ...photo, propertyId })),
            }),
          ]
        : []),
    ]);
  }

  /**
   * `PPH-YYYY-NNNNN` per M1 spec Section 2.1. Sequential within the current
   * year based on existing submission count - acceptable for M1 volumes
   * (collisions, if any, surface as a 500 via the `submissionRef` unique
   * constraint and can be retried by the caller).
   */
  async generateSubmissionRef(): Promise<string> {
    const year = new Date().getFullYear();
    const prefix = `PPH-${year}-`;
    const count = await this.prisma.property.count({
      where: { submissionRef: { startsWith: prefix } },
    });
    return `${prefix}${String(count + 1).padStart(5, '0')}`;
  }
}

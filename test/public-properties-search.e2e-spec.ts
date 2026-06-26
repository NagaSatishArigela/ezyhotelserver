import { INestApplication } from '@nestjs/common';
import {
  BookingPolicy,
  BookingStatus,
  BookingType,
  PaymentStatus,
  Property,
  PropertyStatus,
  RoomTypeCategory,
  User,
  GlobalRole,
  UserStatus,
} from '@prisma/client';
import request from 'supertest';
import { PrismaService } from '../src/modules/database/prisma.service';
import { createTestApp } from './utils/test-app';
import { resetDatabase } from './utils/reset-database';

describe('GET /properties/public (M4 search/filter/sort)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let phoneCounter = 9100000000;

  beforeAll(async () => {
    const harness = await createTestApp();
    app = harness.app;
    prisma = app.get(PrismaService);
  });

  afterAll(async () => {
    await app?.close();
  });

  beforeEach(async () => {
    await resetDatabase(prisma);
    phoneCounter = 9100000000;
  });

  async function createOwner(): Promise<User> {
    phoneCounter += 1;
    return prisma.user.create({
      data: {
        phone: String(phoneCounter),
        email: `owner${phoneCounter}@quicknest.test`,
        passwordHash: 'not-used-in-e2e',
        globalRole: GlobalRole.USER,
        status: UserStatus.active,
        isPhoneVerified: true,
        isEmailVerified: true,
      },
    });
  }

  async function seedProperty(owner: User, overrides: Partial<Property> = {}): Promise<Property> {
    return prisma.property.create({
      data: {
        name: 'PayPerHour Test Hotel',
        ownerId: owner.id,
        status: PropertyStatus.approved,
        isActive: true,
        bookingPolicy: BookingPolicy.both,
        minBookingHours: 3,
        amenities: [],
        ...overrides,
      },
    });
  }

  it('lists approved properties newest-first by default', async () => {
    const owner = await createOwner();
    const older = await seedProperty(owner, { name: 'Older Hotel', city: 'Pune' });
    await prisma.property.update({ where: { id: older.id }, data: { createdAt: new Date('2026-01-01') } });
    const newer = await seedProperty(owner, { name: 'Newer Hotel', city: 'Pune' });
    await prisma.property.update({ where: { id: newer.id }, data: { createdAt: new Date('2026-02-01') } });

    const response = await request(app.getHttpServer()).get('/properties/public').expect(200);

    expect(response.body.total).toBe(2);
    expect(response.body.items.map((item: { id: string }) => item.id)).toEqual([newer.id, older.id]);
  });

  it('filters by q via trigram search across name/description/landmark/city', async () => {
    const owner = await createOwner();
    const match = await seedProperty(owner, {
      name: 'Koramangala Comfort Inn',
      city: 'Bangalore',
      landmark: 'Forum Mall',
    });
    await seedProperty(owner, { name: 'Whitefield Stays', city: 'Bangalore', landmark: 'ITPL' });

    const response = await request(app.getHttpServer())
      .get('/properties/public')
      .query({ q: 'koramangala' })
      .expect(200);

    expect(response.body.items.map((item: { id: string }) => item.id)).toEqual([match.id]);
  });

  it('filters by exact city match (case-insensitive)', async () => {
    const owner = await createOwner();
    const bangalore = await seedProperty(owner, { name: 'Bangalore Hotel', city: 'Bangalore' });
    await seedProperty(owner, { name: 'Pune Hotel', city: 'Pune' });

    const response = await request(app.getHttpServer())
      .get('/properties/public')
      .query({ city: 'bangalore' })
      .expect(200);

    expect(response.body.items.map((item: { id: string }) => item.id)).toEqual([bangalore.id]);
  });

  it('filters by amenities (property must have all listed)', async () => {
    const owner = await createOwner();
    const full = await seedProperty(owner, { name: 'Full Amenities', amenities: ['wifi', 'parking', 'ac'] });
    await seedProperty(owner, { name: 'Wifi Only', amenities: ['wifi'] });

    const response = await request(app.getHttpServer())
      .get('/properties/public')
      .query({ amenities: 'wifi,parking' })
      .expect(200);

    expect(response.body.items.map((item: { id: string }) => item.id)).toEqual([full.id]);
  });

  it('filters by price range against room type hourly rates', async () => {
    const owner = await createOwner();
    const cheap = await seedProperty(owner, { name: 'Budget Stay' });
    await prisma.roomType.create({
      data: { propertyId: cheap.id, type: RoomTypeCategory.nonac, count: 1, hourlyRatePaise: 50000 },
    });
    const expensive = await seedProperty(owner, { name: 'Premium Stay' });
    await prisma.roomType.create({
      data: { propertyId: expensive.id, type: RoomTypeCategory.ac, count: 1, hourlyRatePaise: 200000 },
    });

    const response = await request(app.getHttpServer())
      .get('/properties/public')
      .query({ minPrice: 40000, maxPrice: 100000 })
      .expect(200);

    expect(response.body.items.map((item: { id: string }) => item.id)).toEqual([cheap.id]);
  });

  it('sorts by price_asc and price_desc using the cheapest room type', async () => {
    const owner = await createOwner();
    const cheap = await seedProperty(owner, { name: 'Cheap Hotel' });
    await prisma.roomType.create({
      data: { propertyId: cheap.id, type: RoomTypeCategory.nonac, count: 1, hourlyRatePaise: 50000 },
    });
    const pricey = await seedProperty(owner, { name: 'Pricey Hotel' });
    await prisma.roomType.create({
      data: { propertyId: pricey.id, type: RoomTypeCategory.ac, count: 1, hourlyRatePaise: 200000 },
    });

    const asc = await request(app.getHttpServer())
      .get('/properties/public')
      .query({ sort: 'price_asc' })
      .expect(200);
    expect(asc.body.items.map((item: { id: string }) => item.id)).toEqual([cheap.id, pricey.id]);

    const desc = await request(app.getHttpServer())
      .get('/properties/public')
      .query({ sort: 'price_desc' })
      .expect(200);
    expect(desc.body.items.map((item: { id: string }) => item.id)).toEqual([pricey.id, cheap.id]);
  });

  it('excludes properties with no available rooms for the requested slot', async () => {
    const owner = await createOwner();
    const guest = await createOwner();

    const property = await seedProperty(owner, { name: 'Fully Booked Hotel' });
    const roomType = await prisma.roomType.create({
      data: { propertyId: property.id, type: RoomTypeCategory.ac, count: 1, hourlyRatePaise: 100000 },
    });

    const checkInAt = new Date('2026-07-01T10:00:00.000Z');
    const checkOutAt = new Date('2026-07-01T13:00:00.000Z');
    await prisma.booking.create({
      data: {
        bookingRef: 'PPH-B-SEARCH1',
        propertyId: property.id,
        roomTypeId: roomType.id,
        ownerId: owner.id,
        guestId: guest.id,
        bookingType: BookingType.hourly,
        checkInAt,
        checkOutAt,
        durationHours: 3,
        guestCount: 1,
        baseAmountPaise: 300000,
        gstAmountPaise: 54000,
        platformFeePaise: 0,
        totalAmountPaise: 354000,
        status: BookingStatus.confirmed,
        paymentStatus: PaymentStatus.success,
      },
    });

    const overlapping = await request(app.getHttpServer())
      .get('/properties/public')
      .query({ checkInAt: '2026-07-01T11:00:00.000Z', durationHours: 1 })
      .expect(200);
    expect(overlapping.body.items.map((item: { id: string }) => item.id)).not.toContain(property.id);

    const free = await request(app.getHttpServer())
      .get('/properties/public')
      .query({ checkInAt: '2026-07-02T11:00:00.000Z', durationHours: 1 })
      .expect(200);
    expect(free.body.items.map((item: { id: string }) => item.id)).toContain(property.id);
  });

  it('ignores the rating param without affecting results', async () => {
    const owner = await createOwner();
    const property = await seedProperty(owner, { name: 'Rated Hotel' });

    const response = await request(app.getHttpServer())
      .get('/properties/public')
      .query({ rating: '4' })
      .expect(200);

    expect(response.body.items.map((item: { id: string }) => item.id)).toContain(property.id);
  });

  it('rejects checkInAt without durationHours', async () => {
    await request(app.getHttpServer())
      .get('/properties/public')
      .query({ checkInAt: '2026-07-01T10:00:00.000Z' })
      .expect(400);
  });

  it('rejects durationHours without checkInAt', async () => {
    await request(app.getHttpServer()).get('/properties/public').query({ durationHours: 3 }).expect(400);
  });
});

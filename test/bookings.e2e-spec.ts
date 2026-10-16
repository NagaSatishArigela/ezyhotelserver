import { INestApplication } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import {
  BookingPolicy,
  BookingStatus,
  BookingType,
  GlobalRole,
  Property,
  PropertyRole,
  PropertyStatus,
  RoomType,
  RoomTypeCategory,
  User,
  UserStatus,
} from '@prisma/client';
import request from 'supertest';
import { BookingsService } from '../src/modules/bookings/bookings.service';
import { PrismaService } from '../src/modules/database/prisma.service';
import { createTestApp } from './utils/test-app';
import { resetDatabase } from './utils/reset-database';

/**
 * E2E coverage for the M3 booking lifecycle, exercised over real HTTP
 * against the test database. Unit-level business logic permutations
 * (refund tiers, race conditions, etc.) are already covered by
 * bookings.service.spec.ts - this file focuses on routing, guards, DTO
 * validation, and the full lifecycle wired through Prisma.
 *
 * Requires the test database to be migrated:
 *   npm run prisma:migrate:test
 *   npm run test:e2e
 */
describe('Bookings (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let jwt: JwtService;
  let config: ConfigService;
  let bookingsService: BookingsService;

  let phoneCounter = 9000000000;

  beforeAll(async () => {
    const harness = await createTestApp();
    app = harness.app;
    prisma = app.get(PrismaService);
    jwt = app.get(JwtService);
    config = app.get(ConfigService);
    bookingsService = app.get(BookingsService);
  });

  afterAll(async () => {
    await app?.close();
  });

  beforeEach(async () => {
    await resetDatabase(prisma);
    phoneCounter = 9000000000;
  });

  async function createUser(overrides: Partial<User> = {}): Promise<User> {
    phoneCounter += 1;
    return prisma.user.create({
      data: {
        phone: String(phoneCounter),
        email: `user${phoneCounter}@ezyhotels.test`,
        passwordHash: 'not-used-in-e2e',
        globalRole: GlobalRole.USER,
        status: UserStatus.active,
        isPhoneVerified: true,
        isEmailVerified: true,
        ...overrides,
      },
    });
  }

  async function tokenFor(user: User): Promise<string> {
    return jwt.signAsync(
      { id: user.id, phone: user.phone, globalRole: user.globalRole, sessionId: 'e2e-session' },
      {
        secret: config.getOrThrow<string>('JWT_ACCESS_SECRET'),
        expiresIn: 15 * 60,
        algorithm: 'HS256',
      },
    );
  }

  async function seedProperty(owner: User, overrides: Partial<Property> = {}): Promise<Property> {
    return prisma.property.create({
      data: {
        name: 'PayPerHour Test Hotel',
        ownerId: owner.id,
        status: PropertyStatus.approved,
        bookingPolicy: BookingPolicy.both,
        minBookingHours: 3,
        amenities: [],
        ...overrides,
      },
    });
  }

  async function seedRoomType(propertyId: string, overrides: Partial<RoomType> = {}): Promise<RoomType> {
    return prisma.roomType.create({
      data: {
        propertyId,
        type: RoomTypeCategory.ac,
        count: 1,
        hourlyRatePaise: 100000,
        fulldayRatePaise: 600000,
        maxOccupancy: 2,
        ...overrides,
      },
    });
  }

  function createBookingPayload(overrides: Record<string, unknown> = {}) {
    return {
      bookingType: BookingType.hourly,
      checkInAt: new Date(Date.now() + 5 * 60 * 1000).toISOString(),
      durationHours: 3,
      guestCount: 2,
      ...overrides,
    };
  }

  // Drive the real Layer-C payment flow: order → sandbox checkout → verify.
  // Returns the confirmed booking response body.
  async function payAndConfirm(bookingId: string, token: string) {
    const orderRes = await request(app.getHttpServer())
      .post(`/bookings/${bookingId}/payment/order`)
      .set('Authorization', `Bearer ${token}`)
      .expect(201);
    const { orderId } = orderRes.body;

    const simRes = await request(app.getHttpServer())
      .post(`/bookings/${bookingId}/payment/simulate`)
      .set('Authorization', `Bearer ${token}`)
      .send({ orderId })
      .expect(201);
    const { paymentId, signature } = simRes.body;

    return request(app.getHttpServer())
      .post(`/bookings/${bookingId}/payment/verify`)
      .set('Authorization', `Bearer ${token}`)
      .send({ orderId, paymentId, signature })
      .expect(201);
  }

  describe('POST /bookings', () => {
    it('returns 401 without an access token', async () => {
      await request(app.getHttpServer())
        .post('/bookings')
        .send(createBookingPayload({ propertyId: 'x', roomTypeId: 'x' }))
        .expect(401);
    });

    it('returns 400 for an invalid payload (missing required fields)', async () => {
      const guest = await createUser();
      const token = await tokenFor(guest);

      await request(app.getHttpServer())
        .post('/bookings')
        .set('Authorization', `Bearer ${token}`)
        .send({ propertyId: 'not-a-uuid' })
        .expect(400);
    });

    it('returns 404 if the property does not exist or is not approved', async () => {
      const owner = await createUser();
      const guest = await createUser();
      const token = await tokenFor(guest);
      const draftProperty = await seedProperty(owner, { status: PropertyStatus.draft });
      const roomType = await seedRoomType(draftProperty.id);

      await request(app.getHttpServer())
        .post('/bookings')
        .set('Authorization', `Bearer ${token}`)
        .send(createBookingPayload({ propertyId: draftProperty.id, roomTypeId: roomType.id }))
        .expect(404);
    });

    it('returns 400 if the requested booking type is not allowed by the booking policy', async () => {
      const owner = await createUser();
      const guest = await createUser();
      const token = await tokenFor(guest);
      const property = await seedProperty(owner, { bookingPolicy: BookingPolicy.hourly });
      const roomType = await seedRoomType(property.id);

      await request(app.getHttpServer())
        .post('/bookings')
        .set('Authorization', `Bearer ${token}`)
        .send(
          createBookingPayload({
            propertyId: property.id,
            roomTypeId: roomType.id,
            bookingType: BookingType.fullday,
          }),
        )
        .expect(400);
    });

    it('returns 400 if durationHours is below the property minimum', async () => {
      const owner = await createUser();
      const guest = await createUser();
      const token = await tokenFor(guest);
      const property = await seedProperty(owner, { minBookingHours: 3 });
      const roomType = await seedRoomType(property.id);

      await request(app.getHttpServer())
        .post('/bookings')
        .set('Authorization', `Bearer ${token}`)
        .send(createBookingPayload({ propertyId: property.id, roomTypeId: roomType.id, durationHours: 1 }))
        .expect(400);
    });

    it('returns 400 if guestCount exceeds maxOccupancy', async () => {
      const owner = await createUser();
      const guest = await createUser();
      const token = await tokenFor(guest);
      const property = await seedProperty(owner);
      const roomType = await seedRoomType(property.id, { maxOccupancy: 2 });

      await request(app.getHttpServer())
        .post('/bookings')
        .set('Authorization', `Bearer ${token}`)
        .send(createBookingPayload({ propertyId: property.id, roomTypeId: roomType.id, guestCount: 5 }))
        .expect(400);
    });

    it('returns 409 when the slot is already fully booked (overlap conflict)', async () => {
      const owner = await createUser();
      const guest = await createUser();
      const token = await tokenFor(guest);
      const property = await seedProperty(owner);
      const roomType = await seedRoomType(property.id, { count: 1 });

      const checkInAt = new Date(Date.now() + 60 * 60 * 1000); // +1h

      await request(app.getHttpServer())
        .post('/bookings')
        .set('Authorization', `Bearer ${token}`)
        .send(
          createBookingPayload({
            propertyId: property.id,
            roomTypeId: roomType.id,
            checkInAt: checkInAt.toISOString(),
            durationHours: 3,
          }),
        )
        .expect(201);

      // Overlapping window (+2h, while the first booking occupies +1h..+4h)
      const overlappingCheckIn = new Date(Date.now() + 2 * 60 * 60 * 1000);

      await request(app.getHttpServer())
        .post('/bookings')
        .set('Authorization', `Bearer ${token}`)
        .send(
          createBookingPayload({
            propertyId: property.id,
            roomTypeId: roomType.id,
            checkInAt: overlappingCheckIn.toISOString(),
            durationHours: 3,
          }),
        )
        .expect(409);
    });
  });

  describe('full booking lifecycle', () => {
    it('creates, pays, checks in, and checks out a booking', async () => {
      const owner = await createUser();
      const guest = await createUser();
      const token = await tokenFor(guest);
      const property = await seedProperty(owner);
      const roomType = await seedRoomType(property.id);

      const createRes = await request(app.getHttpServer())
        .post('/bookings')
        .set('Authorization', `Bearer ${token}`)
        .send(createBookingPayload({ propertyId: property.id, roomTypeId: roomType.id }))
        .expect(201);

      const booking = createRes.body;
      expect(booking.status).toBe(BookingStatus.pending_payment);
      expect(booking.baseAmountPaise).toBe(roomType.hourlyRatePaise! * 3);
      expect(booking.gstAmountPaise).toBe(Math.round(booking.baseAmountPaise * 0.18));
      expect(booking.totalAmountPaise).toBe(booking.baseAmountPaise + booking.gstAmountPaise);

      // Pay (order → checkout → verify)
      const payRes = await payAndConfirm(booking.id, token);

      expect(payRes.body.status).toBe(BookingStatus.confirmed);
      expect(payRes.body.paymentStatus).toBe('success');
      expect(payRes.body.qrCode).toEqual(expect.any(String));

      // Re-ordering payment for an already-confirmed booking is a conflict
      await request(app.getHttpServer())
        .post(`/bookings/${booking.id}/payment/order`)
        .set('Authorization', `Bearer ${token}`)
        .expect(409);

      // Get
      const getRes = await request(app.getHttpServer())
        .get(`/bookings/${booking.id}`)
        .set('Authorization', `Bearer ${token}`)
        .expect(200);
      expect(getRes.body.id).toBe(booking.id);

      // Check-in with the wrong QR code fails
      await request(app.getHttpServer())
        .post(`/bookings/${booking.id}/check-in`)
        .set('Authorization', `Bearer ${token}`)
        .send({ qrCode: 'wrong-code' })
        .expect(409);

      // Check-in with the correct QR code succeeds
      const checkInRes = await request(app.getHttpServer())
        .post(`/bookings/${booking.id}/check-in`)
        .set('Authorization', `Bearer ${token}`)
        .send({ qrCode: payRes.body.qrCode })
        .expect(201);
      expect(checkInRes.body.status).toBe(BookingStatus.checked_in);

      // Check-out
      const checkOutRes = await request(app.getHttpServer())
        .post(`/bookings/${booking.id}/check-out`)
        .set('Authorization', `Bearer ${token}`)
        .expect(201);
      expect(checkOutRes.body.status).toBe(BookingStatus.completed);

      // Appears in the guest's booking list
      const listRes = await request(app.getHttpServer())
        .get('/me/bookings')
        .set('Authorization', `Bearer ${token}`)
        .expect(200);
      expect(listRes.body.total).toBe(1);
      expect(listRes.body.items[0].id).toBe(booking.id);
    });

    it('rejects a forged payment signature and leaves the booking pending', async () => {
      const owner = await createUser();
      const guest = await createUser();
      const token = await tokenFor(guest);
      const property = await seedProperty(owner);
      const roomType = await seedRoomType(property.id);

      const createRes = await request(app.getHttpServer())
        .post('/bookings')
        .set('Authorization', `Bearer ${token}`)
        .send(createBookingPayload({ propertyId: property.id, roomTypeId: roomType.id }))
        .expect(201);

      const orderRes = await request(app.getHttpServer())
        .post(`/bookings/${createRes.body.id}/payment/order`)
        .set('Authorization', `Bearer ${token}`)
        .expect(201);

      // A forged {paymentId, signature} must NOT pass verification.
      await request(app.getHttpServer())
        .post(`/bookings/${createRes.body.id}/payment/verify`)
        .set('Authorization', `Bearer ${token}`)
        .send({ orderId: orderRes.body.orderId, paymentId: 'pay_forged', signature: 'deadbeef' })
        .expect(400);

      // Booking is still awaiting payment — not confirmed by a forged signature.
      const getRes = await request(app.getHttpServer())
        .get(`/bookings/${createRes.body.id}`)
        .set('Authorization', `Bearer ${token}`)
        .expect(200);
      expect(getRes.body.status).toBe(BookingStatus.pending_payment);
      expect(getRes.body.paymentStatus).toBe('pending');
    });
  });

  describe('cancellation and refunds', () => {
    it('refunds 100% for an hourly booking cancelled >= 2 hours before check-in', async () => {
      const owner = await createUser();
      const guest = await createUser();
      const token = await tokenFor(guest);
      const property = await seedProperty(owner);
      const roomType = await seedRoomType(property.id);

      const checkInAt = new Date(Date.now() + 3 * 60 * 60 * 1000); // +3h
      const createRes = await request(app.getHttpServer())
        .post('/bookings')
        .set('Authorization', `Bearer ${token}`)
        .send(
          createBookingPayload({
            propertyId: property.id,
            roomTypeId: roomType.id,
            checkInAt: checkInAt.toISOString(),
          }),
        )
        .expect(201);

      await payAndConfirm(createRes.body.id, token);

      const cancelRes = await request(app.getHttpServer())
        .post(`/bookings/${createRes.body.id}/cancel`)
        .set('Authorization', `Bearer ${token}`)
        .send({ reason: 'Change of plans' })
        .expect(201);

      expect(cancelRes.body.status).toBe(BookingStatus.cancelled);
      expect(cancelRes.body.refundAmountPaise).toBe(createRes.body.totalAmountPaise);
    });

    it('refunds 0% for an hourly booking cancelled < 2 hours before check-in', async () => {
      const owner = await createUser();
      const guest = await createUser();
      const token = await tokenFor(guest);
      const property = await seedProperty(owner);
      const roomType = await seedRoomType(property.id);

      const checkInAt = new Date(Date.now() + 60 * 60 * 1000); // +1h
      const createRes = await request(app.getHttpServer())
        .post('/bookings')
        .set('Authorization', `Bearer ${token}`)
        .send(
          createBookingPayload({
            propertyId: property.id,
            roomTypeId: roomType.id,
            checkInAt: checkInAt.toISOString(),
          }),
        )
        .expect(201);

      await payAndConfirm(createRes.body.id, token);

      const cancelRes = await request(app.getHttpServer())
        .post(`/bookings/${createRes.body.id}/cancel`)
        .set('Authorization', `Bearer ${token}`)
        .send({})
        .expect(201);

      expect(cancelRes.body.status).toBe(BookingStatus.cancelled);
      expect(cancelRes.body.refundAmountPaise).toBe(0);
    });

    it('returns 409 when cancelling a booking that is not confirmed', async () => {
      const owner = await createUser();
      const guest = await createUser();
      const token = await tokenFor(guest);
      const property = await seedProperty(owner);
      const roomType = await seedRoomType(property.id);

      const createRes = await request(app.getHttpServer())
        .post('/bookings')
        .set('Authorization', `Bearer ${token}`)
        .send(createBookingPayload({ propertyId: property.id, roomTypeId: roomType.id }))
        .expect(201);

      // Still pending_payment - cannot be cancelled via this endpoint
      await request(app.getHttpServer())
        .post(`/bookings/${createRes.body.id}/cancel`)
        .set('Authorization', `Bearer ${token}`)
        .send({})
        .expect(409);
    });
  });

  describe('authorization', () => {
    it('returns 404 for a booking the requesting guest does not own', async () => {
      const owner = await createUser();
      const guest = await createUser();
      const otherGuest = await createUser();
      const token = await tokenFor(guest);
      const otherToken = await tokenFor(otherGuest);
      const property = await seedProperty(owner);
      const roomType = await seedRoomType(property.id);

      const createRes = await request(app.getHttpServer())
        .post('/bookings')
        .set('Authorization', `Bearer ${token}`)
        .send(createBookingPayload({ propertyId: property.id, roomTypeId: roomType.id }))
        .expect(201);

      await request(app.getHttpServer())
        .get(`/bookings/${createRes.body.id}`)
        .set('Authorization', `Bearer ${otherToken}`)
        .expect(404);

      await request(app.getHttpServer())
        .post(`/bookings/${createRes.body.id}/cancel`)
        .set('Authorization', `Bearer ${otherToken}`)
        .send({})
        .expect(404);
    });

    it('allows the owner to view a booking on their property via /owner/properties/:propertyId/bookings', async () => {
      const owner = await createUser();
      const guest = await createUser();
      const guestToken = await tokenFor(guest);
      const ownerToken = await tokenFor(owner);
      const property = await seedProperty(owner);
      const roomType = await seedRoomType(property.id);

      await prisma.userPropertyRole.create({
        data: { userId: owner.id, propertyId: property.id, role: PropertyRole.OWNER },
      });

      const createRes = await request(app.getHttpServer())
        .post('/bookings')
        .set('Authorization', `Bearer ${guestToken}`)
        .send(createBookingPayload({ propertyId: property.id, roomTypeId: roomType.id }))
        .expect(201);

      // Owner can view the individual booking
      await request(app.getHttpServer())
        .get(`/bookings/${createRes.body.id}`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .expect(200);

      // Owner sees it in the property's booking list
      const listRes = await request(app.getHttpServer())
        .get(`/owner/properties/${property.id}/bookings`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .expect(200);
      expect(listRes.body.total).toBe(1);
      expect(listRes.body.items[0].id).toBe(createRes.body.id);

      // A guest with no relationship to the property is forbidden
      await request(app.getHttpServer())
        .get(`/owner/properties/${property.id}/bookings`)
        .set('Authorization', `Bearer ${guestToken}`)
        .expect(403);
    });
  });

  describe('availability', () => {
    it('reports booked intervals for a room type on a given date', async () => {
      const owner = await createUser();
      const guest = await createUser();
      const token = await tokenFor(guest);
      const property = await seedProperty(owner);
      const roomType = await seedRoomType(property.id, { count: 2 });

      const checkInAt = new Date(Date.now() + 60 * 60 * 1000);
      await request(app.getHttpServer())
        .post('/bookings')
        .set('Authorization', `Bearer ${token}`)
        .send(
          createBookingPayload({
            propertyId: property.id,
            roomTypeId: roomType.id,
            checkInAt: checkInAt.toISOString(),
          }),
        )
        .expect(201);

      const today = new Date().toISOString().slice(0, 10);
      const res = await request(app.getHttpServer())
        .get(`/properties/${property.id}/availability`)
        .query({ roomTypeId: roomType.id, date: today })
        .expect(200);

      expect(res.body.totalRooms).toBe(2);
      expect(res.body.bookedIntervals).toHaveLength(1);
    });
  });

  describe('scheduled lifecycle jobs', () => {
    it('runNoShowDetection marks an overdue confirmed booking as no_show', async () => {
      const owner = await createUser();
      const guest = await createUser();
      const token = await tokenFor(guest);
      const property = await seedProperty(owner);
      const roomType = await seedRoomType(property.id);

      const createRes = await request(app.getHttpServer())
        .post('/bookings')
        .set('Authorization', `Bearer ${token}`)
        .send(createBookingPayload({ propertyId: property.id, roomTypeId: roomType.id }))
        .expect(201);

      await payAndConfirm(createRes.body.id, token);

      // Push the check-in time an hour into the past so it's well past the
      // 30-minute no-show grace window.
      await prisma.booking.update({
        where: { id: createRes.body.id },
        data: { checkInAt: new Date(Date.now() - 60 * 60 * 1000) },
      });

      const processed = await bookingsService.runNoShowDetection(new Date());
      expect(processed).toBe(1);

      const updated = await prisma.booking.findUnique({ where: { id: createRes.body.id } });
      expect(updated?.status).toBe(BookingStatus.no_show);
      expect(updated?.noShowAt).not.toBeNull();
    });

    it('runPaymentTimeouts cancels a stale pending_payment booking', async () => {
      const owner = await createUser();
      const guest = await createUser();
      const token = await tokenFor(guest);
      const property = await seedProperty(owner);
      const roomType = await seedRoomType(property.id);

      const createRes = await request(app.getHttpServer())
        .post('/bookings')
        .set('Authorization', `Bearer ${token}`)
        .send(createBookingPayload({ propertyId: property.id, roomTypeId: roomType.id }))
        .expect(201);

      // Push createdAt 31 minutes into the past (timeout is 30 minutes).
      await prisma.booking.update({
        where: { id: createRes.body.id },
        data: { createdAt: new Date(Date.now() - 31 * 60 * 1000) },
      });

      const processed = await bookingsService.runPaymentTimeouts(new Date());
      expect(processed).toBe(1);

      const updated = await prisma.booking.findUnique({ where: { id: createRes.body.id } });
      expect(updated?.status).toBe(BookingStatus.cancelled);
      expect(updated?.cancelledBy).toBe('system');
      expect(updated?.cancelReason).toBe('payment_timeout');
      expect(updated?.refundAmountPaise).toBe(0);
    });

    it('runAutoCheckout completes a checked-in booking past its checkout time', async () => {
      const owner = await createUser();
      const guest = await createUser();
      const token = await tokenFor(guest);
      const property = await seedProperty(owner);
      const roomType = await seedRoomType(property.id);

      const createRes = await request(app.getHttpServer())
        .post('/bookings')
        .set('Authorization', `Bearer ${token}`)
        .send(createBookingPayload({ propertyId: property.id, roomTypeId: roomType.id }))
        .expect(201);

      const payRes = await payAndConfirm(createRes.body.id, token);

      await request(app.getHttpServer())
        .post(`/bookings/${createRes.body.id}/check-in`)
        .set('Authorization', `Bearer ${token}`)
        .send({ qrCode: payRes.body.qrCode })
        .expect(201);

      // Push checkOutAt one minute into the past.
      await prisma.booking.update({
        where: { id: createRes.body.id },
        data: { checkOutAt: new Date(Date.now() - 60 * 1000) },
      });

      const processed = await bookingsService.runAutoCheckout(new Date());
      expect(processed).toBe(1);

      const updated = await prisma.booking.findUnique({ where: { id: createRes.body.id } });
      expect(updated?.status).toBe(BookingStatus.completed);
      expect(updated?.checkedOutAt).not.toBeNull();
    });
  });
});

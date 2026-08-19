import { INestApplication } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { GlobalRole, User, UserStatus } from '@prisma/client';
import request from 'supertest';
import { PrismaService } from '../src/modules/database/prisma.service';
import { createTestApp } from './utils/test-app';
import { resetDatabase } from './utils/reset-database';

/**
 * Regression coverage for the portal↔server onboarding contract
 * (docs/onboarding-contract.md). Locks the exact 5-step payload shapes the
 * portal wizard emits and the full product loop:
 *   owner onboards → submits → admin approves → property is publicly listed →
 *   a guest books it.
 * Also pins the submit-time failure modes so a regression surfaces as a failed
 * assertion here rather than a mystery "submission failed" for a real owner.
 *
 * Requires the test DB migrated: npm run prisma:migrate:test
 */
describe('Onboarding reconciliation (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let jwt: JwtService;
  let config: ConfigService;
  let phoneCounter = 9100000000;

  beforeAll(async () => {
    const harness = await createTestApp();
    app = harness.app;
    prisma = app.get(PrismaService);
    jwt = app.get(JwtService);
    config = app.get(ConfigService);
  });

  afterAll(async () => {
    await app?.close();
  });

  beforeEach(async () => {
    await resetDatabase(prisma);
    phoneCounter = 9100000000;
  });

  async function createUser(role: GlobalRole = GlobalRole.USER): Promise<User> {
    phoneCounter += 1;
    return prisma.user.create({
      data: {
        phone: String(phoneCounter),
        email: `u${phoneCounter}@quicknest.test`,
        passwordHash: 'not-used-in-e2e',
        globalRole: role,
        status: UserStatus.active,
        isPhoneVerified: true,
        isEmailVerified: true,
      },
    });
  }

  function tokenFor(user: User): Promise<string> {
    return jwt.signAsync(
      { id: user.id, phone: user.phone, globalRole: user.globalRole, sessionId: 'e2e' },
      { secret: config.getOrThrow<string>('JWT_ACCESS_SECRET'), expiresIn: 900, algorithm: 'HS256' },
    );
  }

  // ── Frozen-contract step payloads (docs/onboarding-contract.md) ──────────────
  const step1 = (bookingPolicy = 'both') => ({
    propertyName: 'Skyline Hourly Stay',
    propertyType: 'hotel',
    bookingPolicy,
    businessEntity: 'individual',
    ownerFirstName: 'Ravi',
    ownerLastName: 'Nair',
    category: 'mid',
    description: 'Clean hourly and full-day rooms near the metro station.',
  });
  const step2 = {
    latitude: 12.9716,
    longitude: 77.5946,
    addressLine1: '12 MG Road, Central',
    addressLine2: 'Near Trinity Metro, Ground Floor',
    pincode: '560001',
    city: 'Bengaluru',
    state: 'Karnataka',
  };
  const ROOM_FULL = { type: 'ac', count: 5, hourlyRate: 500, fulldayRate: 3000, maxOccupancy: 2 };
  const step3 = (rooms: object[] = [ROOM_FULL]) => ({
    rooms,
    minBookingHours: '2',
    defaultCheckinTime: '12:00',
    defaultCheckoutTime: '11:00',
    amenities: ['wifi', 'ac', 'parking'],
    houseRules: {
      couple_friendly: 'yes', pet_friendly: 'no', party_allowed: 'no', outside_food: 'on_request',
      alcohol_allowed: 'no', smoking_allowed: 'no', bachelor_groups: 'yes', id_proof_required: 'yes',
    },
  });
  const step4 = { photos: [{ category: 'exterior', url: 'https://cdn.test/e.png', isPrimary: true, sortOrder: 0 }] };
  const step5 = (documents: object[] = [{ type: 'fire_safety_cert', url: 'https://cdn.test/f.pdf' }]) => ({
    legalBusinessName: 'Ravi Nair', pan: 'ABCDE1234F', bankAccountNumber: '123456789012',
    ifsc: 'HDFC0001234', accountHolderName: 'Ravi Nair', tcAccepted: true, formCAcknowledged: true, documents,
  });

  async function newDraft(ownerToken: string): Promise<string> {
    const res = await request(app.getHttpServer())
      .post('/properties/draft').set('Authorization', `Bearer ${ownerToken}`).expect(201);
    return res.body.propertyId;
  }

  async function patchStep(ownerToken: string, pid: string, n: number, body: object, expect = 200) {
    return request(app.getHttpServer())
      .patch(`/properties/${pid}/step/${n}`).set('Authorization', `Bearer ${ownerToken}`).send(body).expect(expect);
  }

  async function fillAll(ownerToken: string, pid: string, over: Partial<{ s1: object; s3: object; s5: object }> = {}) {
    await patchStep(ownerToken, pid, 1, over.s1 ?? step1());
    await patchStep(ownerToken, pid, 2, step2);
    await patchStep(ownerToken, pid, 3, over.s3 ?? step3());
    await patchStep(ownerToken, pid, 4, step4);
    await patchStep(ownerToken, pid, 5, over.s5 ?? step5());
  }

  it('happy path: onboard → submit → approve → publicly listed → booked', async () => {
    const owner = await createUser();
    const ownerToken = await tokenFor(owner);
    const admin = await createUser(GlobalRole.ADMIN);
    const adminToken = await tokenFor(admin);
    const guest = await createUser();
    const guestToken = await tokenFor(guest);

    const pid = await newDraft(ownerToken);
    await fillAll(ownerToken, pid);

    // Submit → pending_review
    const submit = await request(app.getHttpServer())
      .post(`/properties/${pid}/submit`).set('Authorization', `Bearer ${ownerToken}`).expect(201);
    expect(submit.body.status).toBe('pending_review');
    expect(submit.body.submissionRef).toBeTruthy();

    // Admin approves
    await request(app.getHttpServer())
      .post(`/admin/properties/${pid}/approve`).set('Authorization', `Bearer ${adminToken}`).send({}).expect(201);

    // Publicly listed with the materialized data
    const list = await request(app.getHttpServer()).get('/properties/public?limit=50').expect(200);
    const listed = list.body.items.find((p: { id: string }) => p.id === pid);
    expect(listed).toBeTruthy();
    expect(listed.name).toBe('Skyline Hourly Stay');
    expect(listed.primaryImageUrl).toBe('https://cdn.test/e.png');

    // Detail exposes the room type
    const detail = await request(app.getHttpServer()).get(`/properties/public/${pid}`).expect(200);
    const roomTypeId = detail.body.roomTypes[0].id;
    expect(detail.body.roomTypes[0].hourlyRatePaise).toBe(50000); // ₹500 → paise

    // Guest books it
    const booking = await request(app.getHttpServer())
      .post('/bookings').set('Authorization', `Bearer ${guestToken}`)
      .send({
        propertyId: pid, roomTypeId, bookingType: 'hourly',
        checkInAt: new Date(Date.now() + 24 * 3600 * 1000).toISOString(),
        durationHours: 2, guestCount: 2, guestName: 'Ravi Nair', guestPhone: '9876543210',
      })
      .expect(201);
    expect(booking.body.bookingRef).toBeTruthy();
    expect(booking.body.guestName).toBe('Ravi Nair');
    expect(booking.body.totalAmountPaise).toBe(118000); // 500*2 + 18% GST = ₹1180
  });

  it('rejects submit without a fire-safety certificate (400, step 5)', async () => {
    const owner = await createUser();
    const ownerToken = await tokenFor(owner);
    const pid = await newDraft(ownerToken);
    await fillAll(ownerToken, pid, { s5: step5([]) });

    const res = await request(app.getHttpServer())
      .post(`/properties/${pid}/submit`).set('Authorization', `Bearer ${ownerToken}`).expect(400);
    expect(res.body.error.step).toBe(5);
    expect(JSON.stringify(res.body.error.errors)).toContain('Fire safety certificate is required');
  });

  it('rejects submit when a room lacks the rate for the booking policy (400, step 3)', async () => {
    const owner = await createUser();
    const ownerToken = await tokenFor(owner);
    const pid = await newDraft(ownerToken);
    // policy "both" needs both rates; omit hourlyRate
    await fillAll(ownerToken, pid, {
      s3: step3([{ type: 'ac', count: 5, fulldayRate: 3000, maxOccupancy: 2 }]),
    });

    const res = await request(app.getHttpServer())
      .post(`/properties/${pid}/submit`).set('Authorization', `Bearer ${ownerToken}`).expect(400);
    expect(res.body.error.step).toBe(3);
    expect(JSON.stringify(res.body.error.errors)).toContain('hourlyRate is required');
  });

  it('rejects re-submitting an already-submitted property (409)', async () => {
    const owner = await createUser();
    const ownerToken = await tokenFor(owner);
    const pid = await newDraft(ownerToken);
    await fillAll(ownerToken, pid);
    await request(app.getHttpServer())
      .post(`/properties/${pid}/submit`).set('Authorization', `Bearer ${ownerToken}`).expect(201);

    const res = await request(app.getHttpServer())
      .post(`/properties/${pid}/submit`).set('Authorization', `Bearer ${ownerToken}`).expect(409);
    expect(JSON.stringify(res.body)).toContain('Only draft properties can be submitted');
  });

  it('owner portal: dashboard stats, room pricing edit, settings + kill-switch', async () => {
    const owner = await createUser();
    const ownerToken = await tokenFor(owner);
    const admin = await createUser(GlobalRole.ADMIN);
    const adminToken = await tokenFor(admin);

    const pid = await newDraft(ownerToken);
    await fillAll(ownerToken, pid);
    await request(app.getHttpServer())
      .post(`/properties/${pid}/submit`).set('Authorization', `Bearer ${ownerToken}`).expect(201);
    await request(app.getHttpServer())
      .post(`/admin/properties/${pid}/approve`).set('Authorization', `Bearer ${adminToken}`).send({}).expect(201);

    // Dashboard aggregates
    const dash = await request(app.getHttpServer())
      .get(`/owner/properties/${pid}/dashboard`).set('Authorization', `Bearer ${ownerToken}`).expect(200);
    expect(dash.body).toEqual(
      expect.objectContaining({
        total: expect.any(Number), today: expect.any(Number),
        upcoming: expect.any(Number), completed: expect.any(Number), revenuePaise: expect.any(Number),
      }),
    );
    expect(Array.isArray(dash.body.recent)).toBe(true);

    // Analytics window
    const analytics = await request(app.getHttpServer())
      .get(`/owner/properties/${pid}/analytics?days=30`).set('Authorization', `Bearer ${ownerToken}`).expect(200);
    expect(analytics.body.days).toBe(30);
    expect(analytics.body.totals).toEqual(
      expect.objectContaining({ bookings: expect.any(Number), revenuePaise: expect.any(Number) }),
    );
    expect(analytics.body.byType).toEqual(expect.objectContaining({ hourly: expect.any(Number), fullday: expect.any(Number) }));
    expect(Array.isArray(analytics.body.revenueByDay)).toBe(true);

    // Room pricing edit (₹500/hr → ₹600/hr, stored as paise)
    const rooms = await request(app.getHttpServer())
      .get(`/properties/${pid}/rooms`).set('Authorization', `Bearer ${ownerToken}`).expect(200);
    expect(rooms.body[0].hourlyRatePaise).toBe(50000);
    const updRoom = await request(app.getHttpServer())
      .patch(`/properties/${pid}/rooms/${rooms.body[0].id}`).set('Authorization', `Bearer ${ownerToken}`)
      .send({ hourlyRate: 600 }).expect(200);
    expect(updRoom.body.hourlyRatePaise).toBe(60000);

    // Settings + kill-switch: pausing the listing removes it from the storefront
    const settings = await request(app.getHttpServer())
      .get(`/properties/${pid}/settings`).set('Authorization', `Bearer ${ownerToken}`).expect(200);
    expect(settings.body.isActive).toBe(true);
    await request(app.getHttpServer())
      .patch(`/properties/${pid}/settings`).set('Authorization', `Bearer ${ownerToken}`)
      .send({ isActive: false, defaultCheckinTime: '13:00' }).expect(200);
    const listAfter = await request(app.getHttpServer()).get('/properties/public?limit=50').expect(200);
    expect(listAfter.body.items.find((p: { id: string }) => p.id === pid)).toBeFalsy();
  });
});

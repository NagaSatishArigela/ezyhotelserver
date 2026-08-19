import { INestApplication } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import {
  BookingPolicy,
  BookingType,
  BookingStatus,
  GlobalRole,
  LedgerAccount,
  LedgerDirection,
  PaymentGatewayStatus,
  Property,
  PropertyStatus,
  RoomType,
  RoomTypeCategory,
  User,
  UserStatus,
} from '@prisma/client';
import request from 'supertest';
import { PrismaService } from '../src/modules/database/prisma.service';
import { createTestApp } from './utils/test-app';
import { resetDatabase } from './utils/reset-database';

/**
 * Layer C e2e — the money path over real HTTP + DB:
 *   • commission is actually captured (was hardcoded 0)
 *   • payment is gateway-signature-verified, not client-trusted
 *   • capture posts a balanced double-entry ledger transaction
 *   • a forged signature is rejected and captures nothing
 */
describe('Payments + Ledger (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let jwt: JwtService;
  let config: ConfigService;
  let phoneCounter = 9200000000;

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
    phoneCounter = 9200000000;
    // Pin money config so assertions hold regardless of suite run order
    // (platform_settings is a singleton not covered by resetDatabase).
    await prisma.platformSettings.upsert({
      where: { id: 'singleton' },
      create: { id: 'singleton', commissionPct: 15, tdsPct: 1 },
      update: { commissionPct: 15, tdsPct: 1 },
    });
  });

  async function createUser(overrides: Partial<User> = {}): Promise<User> {
    phoneCounter += 1;
    return prisma.user.create({
      data: {
        phone: String(phoneCounter),
        email: `user${phoneCounter}@quicknest.test`,
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
      { secret: config.getOrThrow<string>('JWT_ACCESS_SECRET'), expiresIn: 15 * 60, algorithm: 'HS256' },
    );
  }

  async function seedProperty(owner: User): Promise<Property> {
    return prisma.property.create({
      data: {
        name: 'Layer-C Test Hotel',
        ownerId: owner.id,
        status: PropertyStatus.approved,
        bookingPolicy: BookingPolicy.both,
        minBookingHours: 3,
        amenities: [],
      },
    });
  }

  async function seedRoomType(propertyId: string): Promise<RoomType> {
    return prisma.roomType.create({
      data: {
        propertyId,
        type: RoomTypeCategory.ac,
        count: 1,
        hourlyRatePaise: 100_000, // ₹1,000/hr
        fulldayRatePaise: 600_000,
        maxOccupancy: 2,
      },
    });
  }

  function bookingPayload(propertyId: string, roomTypeId: string) {
    return {
      propertyId,
      roomTypeId,
      bookingType: BookingType.hourly,
      checkInAt: new Date(Date.now() + 5 * 60 * 1000).toISOString(),
      durationHours: 3,
      guestCount: 2,
    };
  }

  it('captures commission and posts a balanced ledger on a verified payment', async () => {
    const owner = await createUser();
    const guest = await createUser();
    const token = await tokenFor(guest);
    const property = await seedProperty(owner);
    const roomType = await seedRoomType(property.id);

    // base = 100_000 × 3 = 300_000; gst = 54_000; total = 354_000
    // commission = 15% × base = 45_000; ownerPayable = 255_000
    const createRes = await request(app.getHttpServer())
      .post('/bookings')
      .set('Authorization', `Bearer ${token}`)
      .send(bookingPayload(property.id, roomType.id))
      .expect(201);

    const booking = createRes.body;
    expect(booking.baseAmountPaise).toBe(300_000);
    expect(booking.gstAmountPaise).toBe(54_000);
    expect(booking.platformFeePaise).toBe(45_000); // commission actually captured
    expect(booking.totalAmountPaise).toBe(354_000); // guest pays base + GST only

    // Step 1 — order
    const orderRes = await request(app.getHttpServer())
      .post(`/bookings/${booking.id}/payment/order`)
      .set('Authorization', `Bearer ${token}`)
      .expect(201);
    expect(orderRes.body.amountPaise).toBe(354_000);
    const { orderId } = orderRes.body;

    // Step 2 — sandbox checkout signs the payment
    const simRes = await request(app.getHttpServer())
      .post(`/bookings/${booking.id}/payment/simulate`)
      .set('Authorization', `Bearer ${token}`)
      .send({ orderId })
      .expect(201);
    const { paymentId, signature } = simRes.body;

    // Step 3 — verify + capture
    const verifyRes = await request(app.getHttpServer())
      .post(`/bookings/${booking.id}/payment/verify`)
      .set('Authorization', `Bearer ${token}`)
      .send({ orderId, paymentId, signature })
      .expect(201);
    expect(verifyRes.body.status).toBe(BookingStatus.confirmed);
    expect(verifyRes.body.paymentStatus).toBe('success');
    expect(verifyRes.body.qrCode).toEqual(expect.any(String));

    // Payment row captured
    const payment = await prisma.payment.findUnique({ where: { gatewayOrderId: orderId } });
    expect(payment?.status).toBe(PaymentGatewayStatus.captured);
    expect(payment?.gatewayPaymentId).toBe(paymentId);

    // Ledger transaction is balanced and split correctly
    const entries = await prisma.ledgerEntry.findMany({
      where: { refType: 'booking', refId: booking.id },
    });
    const sum = (acc: LedgerAccount, dir: LedgerDirection) =>
      entries.filter((e) => e.account === acc && e.direction === dir).reduce((s, e) => s + e.amountPaise, 0);

    expect(sum(LedgerAccount.guest_clearing, LedgerDirection.debit)).toBe(354_000);
    expect(sum(LedgerAccount.owner_payable, LedgerDirection.credit)).toBe(255_000);
    expect(sum(LedgerAccount.platform_commission, LedgerDirection.credit)).toBe(45_000);
    expect(sum(LedgerAccount.gst_payable, LedgerDirection.credit)).toBe(54_000);

    const totalDebit = entries.filter((e) => e.direction === LedgerDirection.debit).reduce((s, e) => s + e.amountPaise, 0);
    const totalCredit = entries.filter((e) => e.direction === LedgerDirection.credit).reduce((s, e) => s + e.amountPaise, 0);
    expect(totalDebit).toBe(totalCredit); // double-entry invariant
    expect(totalDebit).toBe(354_000);
  });

  it('rejects a forged signature, captures nothing, and posts no ledger', async () => {
    const owner = await createUser();
    const guest = await createUser();
    const token = await tokenFor(guest);
    const property = await seedProperty(owner);
    const roomType = await seedRoomType(property.id);

    const createRes = await request(app.getHttpServer())
      .post('/bookings')
      .set('Authorization', `Bearer ${token}`)
      .send(bookingPayload(property.id, roomType.id))
      .expect(201);
    const bookingId = createRes.body.id;

    const orderRes = await request(app.getHttpServer())
      .post(`/bookings/${bookingId}/payment/order`)
      .set('Authorization', `Bearer ${token}`)
      .expect(201);

    await request(app.getHttpServer())
      .post(`/bookings/${bookingId}/payment/verify`)
      .set('Authorization', `Bearer ${token}`)
      .send({ orderId: orderRes.body.orderId, paymentId: 'pay_forged', signature: 'deadbeef' })
      .expect(400);

    const booking = await prisma.booking.findUnique({ where: { id: bookingId } });
    expect(booking?.status).toBe(BookingStatus.pending_payment);

    const payment = await prisma.payment.findUnique({ where: { gatewayOrderId: orderRes.body.orderId } });
    expect(payment?.status).toBe(PaymentGatewayStatus.failed);

    const entries = await prisma.ledgerEntry.count({ where: { refType: 'booking', refId: bookingId } });
    expect(entries).toBe(0);
  });
});

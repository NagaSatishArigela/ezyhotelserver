// Seeds one approved demo property with room types + a photo so the
// payperhour-next guest app has a real propertyId/roomTypeId to drive the
// M3 booking flow end-to-end (M3 Gate 3). Idempotent: re-running updates the
// existing demo property instead of duplicating it.
import { PrismaClient, PropertyStatus, BookingPolicy, PropertyType, PropertyCategory, RoomTypeCategory, GlobalRole, PropertyRole } from '@prisma/client';
import * as bcrypt from 'bcrypt';

const prisma = new PrismaClient();

const DEMO_OWNER_EMAIL = 'demo.owner@payperhour.test';
const DEMO_OWNER_PHONE = '9000000001';
const DEMO_PROPERTY_NAME = 'PayPerHour Demo Suites';
const DEMO_IMAGE_URL =
  'https://lh3.googleusercontent.com/aida-public/AB6AXuAK_Z8mLWjt3mB3skilQAkh2hHch24oMfSC9qLhKur_B0cr0kPZ8VEFEqUAIZBdW-TJLhKwOEinReCanobERH_Ya_HFbagphE-ReqMNvTyooYTwmRRkjAnDrYqGHNMntSZU8qYh1xW9Mjpc86OKhk2guNDILjYizAgnmGOl0UqmUS8sB6m4n0v7SCocP9AawY_anHq0IzfTvcEO0JXnGvD5ZNN_Vx7i8nFoWB7Wyka8atYQqCqpQBu9nP_siTIbBGTIxeacSn-ICqwX';

async function main() {
  const passwordHash = await bcrypt.hash('Demo@12345', 12);

  const owner = await prisma.user.upsert({
    where: { email: DEMO_OWNER_EMAIL },
    update: {},
    create: {
      email: DEMO_OWNER_EMAIL,
      phone: DEMO_OWNER_PHONE,
      passwordHash,
      globalRole: GlobalRole.USER,
      isPhoneVerified: true,
      isEmailVerified: true,
    },
  });

  let property = await prisma.property.findFirst({ where: { name: DEMO_PROPERTY_NAME, ownerId: owner.id } });

  if (!property) {
    property = await prisma.property.create({
      data: {
        name: DEMO_PROPERTY_NAME,
        ownerId: owner.id,
        status: PropertyStatus.approved,
        submissionRef: 'PPH-2026-DEMO1',
        submittedAt: new Date(),
        propertyType: PropertyType.hotel,
        bookingPolicy: BookingPolicy.both,
        category: PropertyCategory.mid,
        description: 'A comfortable demo property for testing the hourly and full-day booking flow.',
        addressLine1: '123 MG Road',
        city: 'Bangalore',
        state: 'Karnataka',
        pincode: '560001',
        landmark: 'Koramangala',
        amenities: ['WiFi', 'AC', 'Parking', 'TV'],
        minBookingHours: 3,
        defaultCheckinTime: '12:00',
        defaultCheckoutTime: '11:00',
        isActive: true,
      },
    });
  } else {
    property = await prisma.property.update({
      where: { id: property.id },
      data: { status: PropertyStatus.approved, isActive: true, bookingPolicy: BookingPolicy.both },
    });
  }

  await prisma.userPropertyRole.upsert({
    where: { userId_propertyId: { userId: owner.id, propertyId: property.id } },
    update: {},
    create: { userId: owner.id, propertyId: property.id, role: PropertyRole.OWNER },
  });

  await prisma.roomType.upsert({
    where: { propertyId_type: { propertyId: property.id, type: RoomTypeCategory.ac } },
    update: { hourlyRatePaise: 80000, fulldayRatePaise: 500000, maxOccupancy: 4, count: 2 },
    create: {
      propertyId: property.id,
      type: RoomTypeCategory.ac,
      count: 2,
      hourlyRatePaise: 80000,
      fulldayRatePaise: 500000,
      maxOccupancy: 4,
    },
  });

  await prisma.roomType.upsert({
    where: { propertyId_type: { propertyId: property.id, type: RoomTypeCategory.nonac } },
    update: { hourlyRatePaise: 50000, fulldayRatePaise: 350000, maxOccupancy: 3, count: 3 },
    create: {
      propertyId: property.id,
      type: RoomTypeCategory.nonac,
      count: 3,
      hourlyRatePaise: 50000,
      fulldayRatePaise: 350000,
      maxOccupancy: 3,
    },
  });

  const existingPhoto = await prisma.propertyPhoto.findFirst({ where: { propertyId: property.id } });
  if (!existingPhoto) {
    await prisma.propertyPhoto.create({
      data: {
        propertyId: property.id,
        category: 'exterior',
        url: DEMO_IMAGE_URL,
        isPrimary: true,
        sortOrder: 0,
      },
    });
  }

  console.log('Seeded demo property:', { propertyId: property.id, ownerId: owner.id });
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());

import { GlobalRole, PrismaClient, UserStatus } from '@prisma/client'
import * as bcrypt from 'bcrypt'

const prisma = new PrismaClient()

async function upsertUser(
  email: string, phone: string, name: string,
  role: GlobalRole, hash: string
) {
  // Try email-based upsert; if phone conflicts, update the existing record
  try {
    return await prisma.user.upsert({
      where: { email },
      update: { name, passwordHash: hash, globalRole: role, status: UserStatus.active },
      create: { name, phone, email, passwordHash: hash, globalRole: role, isPhoneVerified: true, isEmailVerified: true, status: UserStatus.active },
    })
  } catch (err: unknown) {
    if ((err as { code?: string }).code === 'P2002') {
      // Phone conflict — update by phone instead
      return prisma.user.update({ where: { phone }, data: { name, email, passwordHash: hash, globalRole: role } })
    }
    throw err
  }
}

async function main() {
  // Guard: never seed demo super-admin/admin credentials into a production DB.
  // A real environment must provision its first super-admin out-of-band.
  if (process.env.NODE_ENV === 'production' && process.env.ALLOW_PROD_SEED !== 'true') {
    throw new Error(
      'Refusing to seed in production. Set ALLOW_PROD_SEED=true only if you really intend this.',
    )
  }

  console.log('🌱 Seeding EzyHotels database…')

  // Credentials come from env so they are never hard-coded/committed; the
  // literals below are dev-only conveniences.
  const DEFAULT_PASSWORD = process.env.SEED_ADMIN_PASSWORD ?? 'Admin@123!'
  const hash = await bcrypt.hash(DEFAULT_PASSWORD, 12)

  const superAdmin = await upsertUser('superadmin@ezyhotels.com', '9000000001', 'Super Admin', GlobalRole.SUPER_ADMIN, hash)
  console.log('  ✅ Super admin:', superAdmin.email)

  const admin = await upsertUser('admin@ezyhotels.com', '9000000002', 'Platform Admin', GlobalRole.ADMIN, hash)
  console.log('  ✅ Admin:', admin.email)

  const ownerPassword = process.env.SEED_OWNER_PASSWORD ?? 'Owner@123!'
  const ownerHash = await bcrypt.hash(ownerPassword, 12)
  const owner = await upsertUser('owner@ezyhotels.com', '9000000003', 'Demo Owner', GlobalRole.USER, ownerHash)
  console.log('  ✅ Demo owner:', owner.email)

  const supportPassword = process.env.SEED_SUPPORT_PASSWORD ?? 'Support@123!'
  const supportHash = await bcrypt.hash(supportPassword, 12)
  const support = await upsertUser('support@ezyhotels.com', '9000000004', 'Support Agent', GlobalRole.SUPPORT, supportHash)
  console.log('  ✅ Support agent:', support.email)

  // ── Sample support tickets (real rows raised by the demo owner) ──
  if ((await prisma.supportTicket.count()) === 0) {
    await prisma.supportTicket.createMany({
      data: [
        {
          subject: 'Payout for last week not received',
          description: 'My D+1 settlement for last week has not landed in my HDFC account yet. Booking ref PPH-B-1234.',
          priority: 'high',
          category: 'Payouts',
          raisedByUserId: owner.id,
        },
        {
          subject: 'How do I update my hourly pricing?',
          description: 'I want to raise my AC room hourly rate for the weekend. Where can I do that in the portal?',
          category: 'Onboarding',
          raisedByUserId: owner.id,
        },
      ],
    })
    console.log('  ✅ Seeded 2 sample support tickets')
  }

  // ── Platform settings (singleton) ──────────────────────────────
  await prisma.platformSettings.upsert({
    where: { id: 'singleton' },
    update: {},
    create: {
      commissionPct: 12,
      tdsPct: 1,
      payoutDayOfWeek: 1,       // Monday
      minBookingHours: 2,
      maxBookingHours: 24,
      cancellationWindowHours: 1,
    },
  })
  console.log('  ✅ Platform settings (commission 12%, TDS 1%)')

  console.log('\n🎉 Seed complete!')
  console.log('\nCredentials (passwords come from SEED_ADMIN_PASSWORD / SEED_OWNER_PASSWORD, or the dev defaults):')
  console.log('  Super Admin  superadmin@ezyhotels.com')
  console.log('  Admin        admin@ezyhotels.com')
  console.log('  Owner        owner@ezyhotels.com')
}

main()
  .catch((e) => { console.error(e); process.exit(1) })
  .finally(() => prisma.$disconnect())

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
  console.log('🌱 Seeding Stayflex database…')

  const DEFAULT_PASSWORD = 'Admin@123!'
  const hash = await bcrypt.hash(DEFAULT_PASSWORD, 12)

  const superAdmin = await upsertUser('superadmin@stayflex.in', '9000000001', 'Super Admin', GlobalRole.SUPER_ADMIN, hash)
  console.log('  ✅ Super admin:', superAdmin.email)

  const admin = await upsertUser('admin@stayflex.in', '9000000002', 'Platform Admin', GlobalRole.ADMIN, hash)
  console.log('  ✅ Admin:', admin.email)

  const ownerHash = await bcrypt.hash('Owner@123!', 12)
  const owner = await upsertUser('owner@stayflex.in', '9000000003', 'Demo Owner', GlobalRole.USER, ownerHash)
  console.log('  ✅ Demo owner:', owner.email)

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
  console.log('\nCredentials:')
  console.log('  Super Admin  superadmin@stayflex.in  Admin@123!')
  console.log('  Admin        admin@stayflex.in       Admin@123!')
  console.log('  Owner        owner@stayflex.in       Owner@123!')
}

main()
  .catch((e) => { console.error(e); process.exit(1) })
  .finally(() => prisma.$disconnect())

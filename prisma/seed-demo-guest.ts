import { PrismaClient } from '@prisma/client';
import * as bcrypt from 'bcrypt';

const prisma = new PrismaClient();

async function main() {
  const email = 'demo.guest@payperhour.test';
  const phone = '9876500001';
  const password = 'Guest@12345';
  const passwordHash = await bcrypt.hash(password, 10);

  const user = await prisma.user.upsert({
    where: { email },
    update: {},
    create: {
      email,
      phone,
      passwordHash,
      isPhoneVerified: true,
      isEmailVerified: true,
      status: 'active',
    },
  });

  console.log('Seeded demo guest:', { userId: user.id, email, password });
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());

import { PrismaClient } from '@prisma/client';

/**
 * Truncates every application table across all domain schemas, leaving the
 * schema/table structure (and Prisma's `_prisma_migrations` table) intact.
 *
 * Intended for use between e2e tests against the dedicated test database
 * (`DATABASE_URL` from `.env.test`) - NEVER point this at a dev/prod DB.
 */
export async function resetDatabase(prisma: PrismaClient): Promise<void> {
  const tables = await prisma.$queryRaw<Array<{ schemaname: string; tablename: string }>>`
    SELECT schemaname, tablename
    FROM pg_tables
    WHERE schemaname IN ('auth', 'properties', 'bookings', 'finance', 'notifications', 'reviews', 'compliance')
      AND tablename != '_prisma_migrations'
  `;

  if (tables.length === 0) {
    return;
  }

  const identifiers = tables
    .map((t) => `"${t.schemaname}"."${t.tablename}"`)
    .join(', ');

  await prisma.$executeRawUnsafe(
    `TRUNCATE TABLE ${identifiers} RESTART IDENTITY CASCADE;`,
  );
}

// Global setup for e2e/integration tests, run via Jest's `setupFilesAfterEnv`
// (after `.env.test` has been loaded by `load-test-env.ts`).
//
// Individual specs are responsible for resetting database state between
// tests via `test/utils/reset-database.ts` - this file only sets process-wide
// safety nets so a misconfigured environment fails loudly instead of quietly
// running against the wrong database.

const dbUrl = process.env.DATABASE_URL ?? '';

if (process.env.NODE_ENV !== 'test') {
  throw new Error(
    `Refusing to run e2e tests with NODE_ENV=${process.env.NODE_ENV}. ` +
      'Expected "test" - check that .env.test is loaded.',
  );
}

if (!dbUrl.includes('quicknest_test')) {
  throw new Error(
    'Refusing to run e2e tests: DATABASE_URL does not look like the test ' +
      `database (got "${dbUrl}"). Check .env.test.`,
  );
}

jest.setTimeout(30_000);

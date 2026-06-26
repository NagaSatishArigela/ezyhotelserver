import { config } from 'dotenv';
import { resolve } from 'path';

// Loaded via Jest's `setupFiles` (runs before the test framework and any
// application modules are required), so `process.env` is fully populated
// with the `.env.test` values before NestJS's ConfigModule reads them.
//
// `override: true` ensures values from `.env.test` win over anything an
// inherited shell/CI environment may already have set for these keys.
config({ path: resolve(__dirname, '..', '.env.test'), override: true });

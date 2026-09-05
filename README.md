# ezyhotelsserver

EzyHotels server is the backend API for authentication, user session management, and property access control.

## Auth & Session Hardening

This repository includes a production-ready auth layer with:

- OTP-based login and registration
- Secure OTP storage and verification with rate limits and lockouts
- JWT access tokens with refresh token rotation
- Fixed refresh expiry policy (refresh does not extend session lifetime)
- Atomic refresh rotation using Prisma `updateMany`
- Replay protection for refresh tokens
- Session revocation and idempotent logout
- Scheduled cleanup of expired sessions
- Structured logging for auth events and guard denials

## Database Schema

The Prisma schema includes:

- `Session` model with indexes on `userId`, `expiresAt`, and `createdAt`
- defensive uniqueness constraints for refresh token data

## Running Tests

From `ezyhotelsserver`:

```bash
npm test
```

Targeted auth tests can be run with:

```bash
npm test -- --runInBand src/modules/auth/__tests__/auth.service.spec.ts src/modules/auth/__tests__/session-cleanup.service.spec.ts
```

## E2E / Integration Tests

E2E tests boot the full Nest application (real Postgres + Redis) against a
dedicated **test database**, never the dev database.

1. One-time setup:
   - Create the test database: `CREATE DATABASE ezyhotels_test;` on the same
     Postgres instance as `DATABASE_URL` in `.env` (default: `localhost:5433`).
   - Review `.env.test` (already populated with test-only secrets and
     `DATABASE_URL=postgresql://postgres:password@localhost:5433/ezyhotels_test`).
   - Apply migrations to the test database:
     ```bash
     npm run prisma:migrate:test
     ```
2. Run the suite:
   ```bash
   npm run test:e2e
   ```

Notes:
- `test/load-test-env.ts` loads `.env.test` (overriding any inherited env)
  before the app boots.
- `test/setup-e2e.ts` refuses to run unless `NODE_ENV=test` and `DATABASE_URL`
  points at `ezyhotels_test`, as a guardrail against accidentally truncating
  the dev database.
- `test/utils/reset-database.ts` truncates all domain-schema tables between
  tests (`beforeEach`).
- `test/utils/test-app.ts` provides `createTestApp()`, mirroring the global
  pipes/filters from `src/main.ts` for use with `supertest`.
- `npm run test:integration` runs the same Jest e2e config filtered to spec
  files matching `integration` - reserved for heavier cross-module tests
  added as later modules (M3+) land.

## E2E Flow Tests (Playwright)

Frontend E2E flow tests (Gate 4 of the per-module factory loop) live in
`payperhour-next/e2e/` and run via Playwright:

```bash
cd ../payperhour-next
npm run test:e2e       # headless
npm run test:e2e:ui    # interactive UI mode
```

By default Playwright starts `npm run dev` (port 3000) for you. Set
`E2E_BASE_URL` to point at an already-running instance instead (e.g. in CI).
The backend API (`ezyhotelsserver`, port 4000) must be started separately.

## Notes

- `@nestjs/schedule` is used for session cleanup.
- `bcrypt` is used for refresh token hashing and OTP hashing.
- Prisma is used for session persistence and atomic updates.

## Firebase Phone Auth integration

- You can use Firebase phone auth instead of MSG91 for OTP verification.
- This server provides `POST /auth/firebase` to verify Firebase ID tokens and issue local JWT/session tokens.
- Set the Firebase service account values in your `.env`:
  - `FIREBASE_PROJECT_ID`
  - `FIREBASE_CLIENT_EMAIL`
  - `FIREBASE_PRIVATE_KEY`
  - `FIREBASE_DATABASE_URL` (optional)

## Environment variables

For Cloudflare R2 (S3-compatible) hotel image and verification document uploads:

```env
S3_ENDPOINT=https://b23d713271dd401d24cd18b4f687c12c.r2.cloudflarestorage.com/ezyhotels-staging
S3_BUCKET=ezyhotels-staging
S3_REGION=auto
S3_ACCESS_KEY_ID=your-r2-access-key
S3_SECRET_ACCESS_KEY=your-r2-secret-key
S3_PUBLIC_BASE_URL=https://your-public-r2-domain.example
```

The portal calls `POST /uploads/presign` with the property ID, file type, MIME
type, and size. The browser then uploads directly to R2 with the returned PUT
URL. Configure the bucket CORS policy to allow `PUT` from the portal origins
(`http://localhost:3000` and the staging portal origin). Keep verification
documents private and use a public/custom domain only for media that should be
rendered by guests.

For Firebase and generic SMS gateway support, add:

```env
FIREBASE_PROJECT_ID=your-firebase-project-id
FIREBASE_CLIENT_EMAIL=your-firebase-client-email
FIREBASE_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----\n"
SMS_GATEWAY_URL=https://your-sms-provider.example/api/send
SMS_GATEWAY_API_KEY=your-sms-provider-key
```


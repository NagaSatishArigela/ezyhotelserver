# quicknestserver

QuickNest server is the backend API for authentication, user session management, and property access control.

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

From `quicknestserver`:

```bash
npm test
```

Targeted auth tests can be run with:

```bash
npm test -- --runInBand src/modules/auth/__tests__/auth.service.spec.ts src/modules/auth/__tests__/session-cleanup.service.spec.ts
```

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

For Firebase and generic SMS gateway support, add:

```env
FIREBASE_PROJECT_ID=your-firebase-project-id
FIREBASE_CLIENT_EMAIL=your-firebase-client-email
FIREBASE_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----\n"
SMS_GATEWAY_URL=https://your-sms-provider.example/api/send
SMS_GATEWAY_API_KEY=your-sms-provider-key
```


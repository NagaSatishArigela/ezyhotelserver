# quicknestserver — history & context

> Handoff doc for developers picking up this repo. Complements `CLAUDE.md`
> (coding rules) and `README.md` (usage). Last updated: 2026-08.

---

## What this is

The **backend API** for **EzyHotels.com** — an hourly / 24-hour hotel booking
platform ("Pay Less, Stay More"). Owners onboard and submit a property → admin
reviews/approves → it lists on the public storefront → guests book by the hour →
pay → check in with a QR.

NestJS **modular monolith**, TypeScript, Prisma over **multi-schema Postgres**.
Runs on **port 4000**.

## The three apps (this is one of them)

| Repo | Role | Port | Stack |
|------|------|------|-------|
| **quicknestserver** (this) | Backend API + DB | 4000 | NestJS + Prisma + Postgres + Redis |
| quicknestweb | Public storefront (guests) | 3001 | Next.js 16 |
| quicknestportal | Owner / Admin / Support portal | 3000 | Vite + React |

The portal proxies API calls to `:4000`; the storefront calls `:4000` directly.
**Contract source of truth is this server** — the onboarding wizard contract is
frozen in [`docs/onboarding-contract.md`](docs/onboarding-contract.md) (5 server
steps; the portal maps its 7-step UX onto them).

## Architecture rules (important)

- **Domains talk only via EventEmitter2** (`src/common/events`) — never inject a
  service from another domain module. This keeps domains independently
  extractable. Exceptions are `@Global` shared-kernel modules: `DatabaseModule`
  (PrismaService), `PlatformModule` (PlatformConfigService), `FinanceModule`
  (LedgerService + PAYMENT_GATEWAY).
- **Multi-schema Postgres.** Prisma `schemas`: `auth, properties, bookings,
  finance, notifications, reviews, compliance, wallet, payouts, platform,
  support`. Cross-schema references carry **no** Prisma relation/FK — they're
  resolved with application-level lookups (modular-monolith isolation).
- **Money is integer paise** everywhere. Rupee amounts in wizard payloads are
  converted to paise on materialization.
- DTOs use class-validator with `whitelist` + `forbidNonWhitelisted`.
- Rate limiting is tiered (`ThrottlerModule`); `TestAwareThrottlerGuard` skips
  throttling when `NODE_ENV=test`.

## Current state

**Working & tested** (unit: 351/352 green — the 1 failure is a pre-existing,
unrelated OTP-dev-logging test; e2e: 41/41 green against a real test DB):

- Auth (JWT access/refresh, OTP, sessions), roles: `SUPER_ADMIN / ADMIN /
  SUPPORT / USER`.
- Property onboarding (5 steps + submit + admin review/approve/revise),
  `businessEntity` first-class, real file uploads to local disk (`uploads/`,
  gitignored; prod would use object storage).
- Public property search (`status=approved AND isActive=true` — `isActive` is a
  real kill-switch).
- Bookings lifecycle: create (past-date/horizon guards, GST 18%), pay, check-in
  (QR), check-out, cancel/refund tiers, no-show + payment-timeout schedulers.
- **Layer C — money (sandbox seam), added this session:**
  - `PaymentGateway` interface + `SandboxPaymentGateway` (real HMAC-SHA256
    signature, nothing charged) selected by `PAYMENT_PROVIDER`. Flow:
    `POST /bookings/:id/payment/order` → `POST .../payment/simulate` (sandbox
    only, stands in for the hosted checkout) → `POST .../payment/verify`
    (signature-verified capture). The old client-trusted `.../payment/confirm`
    was **removed**.
  - `PaymentsService` (`src/modules/bookings/payments.service.ts`) captures
    atomically in one Prisma transaction: booking → confirmed, `finance.Payment`
    → captured, and a balanced `finance.LedgerEntry` set.
  - **Commission** is now real: `platformFeePaise = round(base ×
    commissionPct/100)` from `platform.PlatformSettings` (default 15%),
    deducted from the owner payout — NOT added to the guest total. (It used to be
    a flat env `= 0`.)
  - **Double-entry ledger** (`src/modules/finance/ledger.service.ts`) enforces
    debits == credits on every post. Posts on capture and on payout release.
  - **TDS** in payouts reads `tdsPct` from settings (was hardcoded 1%).
- **Support system** (`src/modules/support`): tickets (raise / my-tickets /
  agent queue / resolve / escalate / user lookup with no passwordHash leak).
- **Owner backends**: dashboard, analytics, settings (checkin/out, minHours,
  `isActive` kill-switch), rooms (rupee→paise pricing).
- **Payouts** (`src/modules/payouts`): weekly batch generate / release / hold,
  TDS, owner + admin views.

**Mocked / parked (intentional):**
- Payment gateway is **sandbox only** — no real money moves. Going live = set
  `PAYMENT_PROVIDER=razorpay` + keys and add one adapter class; no caller
  changes. Refund-path ledger entries are not written yet.
- SMS / email / Firebase gateways are configured by env but not wired to a real
  provider in dev.

## How to run (local dev)

**Prerequisites:** Docker Desktop, Node 20.

```bash
# 1. Start Postgres (host :5433) + Redis (:6379). Creates quicknest + quicknest_test.
docker compose up -d

# 2. Env — copy the template and fill in the secret placeholders.
#    DATABASE_URL/REDIS_URL already point at the compose services.
cp .env.example .env
#    Generate secrets, e.g.:  openssl rand -hex 48

# 3. Install + generate client
npm install
npm run prisma:generate

# 4. Schema + demo data (dev DB)
npx prisma migrate dev
npm run prisma:seed

# 5. Migrate the test DB (needed for e2e)
npm run prisma:migrate:test

# 6. Run the API on :4000
npm run start:dev
```

**Tests:**
```bash
npm test                          # unit (jest)
npm run test:e2e                  # e2e (needs docker compose up + prisma:migrate:test)
```

**Demo accounts** (created by `prisma:seed`; passwords overridable via
`SEED_ADMIN_PASSWORD` / `SEED_OWNER_PASSWORD` / `SEED_SUPPORT_PASSWORD`):

| Role | Email | Default password |
|------|-------|------------------|
| Super Admin | superadmin@ezyhotels.com | Admin@123! |
| Admin | admin@ezyhotels.com | Admin@123! |
| Owner | owner@ezyhotels.com | Owner@123! |
| Support | support@ezyhotels.com | Support@123! |

The seed refuses to run in production unless `ALLOW_PROD_SEED=true`.

## Gotchas / watch-outs

- **If you inherit an existing dev DB** seeded before the EzyHotels rebrand, it
  still holds the old `@stayflex.in` accounts (and maybe stray drafts). Re-run
  `npm run prisma:seed` for the `@ezyhotels.com` accounts, or wipe with
  `docker compose down -v` and re-migrate/seed for a clean slate.
- Prisma client generation can hit an EPERM/DLL lock on Windows if the API is
  running — stop `start:dev` (or the node process on :4000) before
  `prisma generate` / `migrate`.
- Pre-existing failing unit test: `otp-delivery.service.spec.ts` (message drift +
  it logs the OTP in cleartext in the dev-fallback path). Unrelated to Layer C;
  worth fixing (mask the OTP, align the message).
- **Guest self-check-in** (`checkIn`/`checkOut`) is currently authorized against
  the guest's own id — physically it should be owner/staff-scoped (property
  verifies the guest's QR). Flagged in code; not yet redesigned.

## Next steps / TODO

- Real payment adapter (Razorpay) behind the existing `PaymentGateway` seam +
  refund-path ledger entries.
- Fix the OTP-logging test/impl.
- Owner/staff-scoped check-in.
- Going forward: **feature branches + PRs** (this session was committed straight
  to `master` as a one-time catch-up).

## Related

- Storefront: `quicknestweb/history-context.md`
- Portal: `quicknestportal/history-context.md`
- Onboarding contract: `docs/onboarding-contract.md`

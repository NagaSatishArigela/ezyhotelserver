# M1: Hotel Onboarding (Property Submission) — Gate 0 Spec Lock

Status: LOCKED for Gate 1 implementation
Source: `Updated_Onboarding_Spec.docx` (PayPerHour, March 2026), `payperhour-next/modules/owner/schemas/index.ts`,
`payperhour-next/modules/owner/{constants,amenities,houseRules}.ts`

## 1. Scope boundary

The onboarding spec describes 4 phases. M0 already covers **Phase 1 (Account
Creation)** — `POST /auth/register`, OTP verification, JWT issuance, role
defaults. M1 covers **Phase 2 (Property Submission)** only:

| In scope (M1) | Out of scope (later modules) |
|---|---|
| Property draft create/auto-save (5-step wizard) | Admin approve/reject/request-revision endpoints (**M2B**) |
| Step validation per step 1-5 | Owner notification inbox table + endpoints (**M2**) |
| GSTIN/PAN/bank-details encryption + GSTIN dedup | Email/SMS sending (**M2**, notifications module subscribes to events) |
| Submission (`pending_review`, `submission_ref`) | Elasticsearch indexing on approval (**M4**) |
| Status/timeline retrieval (derived from Property fields) | GSTIN/IFSC third-party auto-validation APIs (Sprint 5, deferred) |
| Resubmission after `needs_revision` (`PATCH /revise`) | Photo file upload/storage (S3 presigned URLs) — DTOs accept `url`/`key` strings; actual upload pipeline tracked separately |
| Domain events: `hotel.onboarding.submitted` (already defined) | `hotel.verified` / `hotel.rejected` consumed by M2B/M2, not emitted by M1 |

M1 emits `hotel.onboarding.submitted` on submit and on resubmit-after-revision.
`hotel.verified`/`hotel.rejected` are emitted by M2B (admin module) — M1 only
needs to be able to receive the resulting status via the `revise` flow, which
reads `status`/`revisionNotes` written by M2B directly on the `Property` row
(same schema, no event needed for that direction).

## 2. Data model (additions to `prisma/schema.prisma`)

### 2.1 `properties` schema

**`Property`** (extend existing model):

| Column | Type | Notes |
|---|---|---|
| `status` | `PropertyStatus` enum, default `draft` | `draft, pending_review, needs_revision, approved, rejected, suspended` |
| `draftStep` | `Int?` | 1-5, current wizard step. `null` once submitted. |
| `draftData` | `Json?` | Accumulated step 1-4 payloads (steps not yet materialized). Cleared on submit. |
| `submissionRef` | `String? @unique` | `PPH-YYYY-NNNNN`, assigned on first submit |
| `submittedAt` | `DateTime?` | |
| `revisionCount` | `Int` default 0 | capped at 3 (enforced by M2B; M1 just reads/displays) |
| `revisionNotes` | `Json?` | `[{adminId, timestamp, items: [{field, reason}]}]`, written by M2B |
| `propertyType` | `PropertyType` enum | hotel/resort/homestay/villa/pg/farm/banquet/other |
| `bookingPolicy` | `BookingPolicy` enum | hourly/fullday/both |
| `category` | `PropertyCategory?` enum | budget/mid/premium |
| `description` | `String? @db.VarChar(200)` | |
| `ownerFirstName`/`ownerMiddleName`/`ownerLastName` | `String`/`String?`/`String` | legal (Aadhaar) name, distinct from account name |
| `addressLine1`,`addressLine2`,`city`,`state`,`pincode`,`landmark`,`specialNote` | location fields | `specialNote` max 200 |
| `latitude`,`longitude` | `Decimal?` | |
| `amenities` | `String[]` | flattened selected amenity labels |
| `houseRules` | `Json?` | step3c payload |
| `minBookingHours` | `Int?` | 1/2/3, only if `bookingPolicy != fullday` |
| `defaultCheckinTime`,`defaultCheckoutTime` | `String?` (HH:mm) | defaults `12:00`/`11:00` applied at submit |
| `seatingCapacity` | `Int?` | banquet-type only |
| `deletionRequestedAt`,`deletionScheduledFor` | `DateTime?` | from earlier 72h/30d deletion-tier discussion |
| `deletionTrack` | `DeletionTrack?` enum | `fast_72h`/`standard_30d` |
| `isActive` | `Boolean` default `true` | immediate deactivation on deletion request |

**`RoomType`** (new model, materialized on submit from `draftData.rooms`):

| Column | Type |
|---|---|
| `id` | uuid PK |
| `propertyId` | uuid (cross-schema ref, no FK) |
| `type` | enum `ac/nonac/dorm/suite` |
| `count` | int |
| `hourlyRatePaise` | int? (rupees × 100, avoids float issues) |
| `fulldayRatePaise` | int? |
| `maxOccupancy` | int? |

`@@unique([propertyId, type])`

**`PropertyPhoto`** (new model):

| Column | Type |
|---|---|
| `id` | uuid PK |
| `propertyId` | uuid |
| `category` | enum (5 categories: exterior/rooms/bathroom/amenities/dining — confirm exact labels with frontend; stored as string for now) |
| `url` | string |
| `isPrimary` | boolean default false |
| `sortOrder` | int default 0 |

Max 5 per category enforced in service layer (25 total).

### 2.2 `compliance` schema

**`PropertyComplianceDoc`** (new model — one row per property, 1:1):

| Column | Type | Notes |
|---|---|---|
| `id` | uuid PK | |
| `propertyId` | uuid unique (cross-schema ref) | |
| `legalBusinessName` | string | |
| `gstinEncrypted` | string | AES-256-GCM via `EncryptionService` |
| `gstinHash` | string @unique | HMAC lookup hash, dedup check |
| `panEncrypted` | string | |
| `panHash` | string | (not unique — same PAN can own multiple properties) |
| `bankAccountNumberEncrypted` | string | |
| `bankAccountNumberHash` | string | |
| `ifsc` | string | not sensitive, stored plain |
| `accountHolderName` | string | |
| `tcAcceptedAt` | DateTime | |
| `formCAcknowledgedAt` | DateTime | |

**`PropertyDocument`** (new model — supports multiple docs: PAN card image,
ID proof, owner photo, rental agreement, fire safety cert, FSSAI, trade
license, etc.):

| Column | Type | Notes |
|---|---|---|
| `id` | uuid PK | |
| `propertyId` | uuid | |
| `type` | `DocumentType` enum | `owner_photo, id_proof, pan_card, gstin_certificate, rental_agreement, fire_safety_cert, fssai_license, trade_license, other` |
| `url` | string | |
| `status` | `DocumentStatus` enum default `pending` | `pending, verified, rejected, expired` |
| `expiresAt` | DateTime? | for fire safety / trade license / FSSAI |
| `rejectionReason` | string? | set by M2B |

## 3. API surface (M1)

All routes under `/properties`, guarded by `JwtAuthGuard` +
`PropertyRoleGuard(OWNER)` (existing guard from M0; for `POST /properties/draft`
there's no propertyId yet, so it only requires an authenticated user with
`globalRole=USER` who will become `OWNER` via a new `UserPropertyRole` row
created at draft-creation time).

| Method | Path | Purpose |
|---|---|---|
| POST | `/properties/draft` | Create new draft. Creates `Property` row (`status=draft`) + `UserPropertyRole(OWNER)` for the caller. Returns `{ propertyId }`. |
| PATCH | `/properties/:id/step/:stepNum` | Auto-save step `1-5` payload. Steps 1-4 merge into `draftData`; step 5 writes `PropertyComplianceDoc` + `PropertyDocument` rows directly (encrypted). Updates `draftStep = max(draftStep, stepNum)`. |
| GET | `/properties/:id/draft` | Returns `draftData` + `draftStep` + materialized step-5 summary (masked GSTIN/PAN/bank via `maskValue`). For resume-from-draft. |
| POST | `/properties/:id/submit` | Validates steps 1-5 complete, materializes `RoomType`/`PropertyPhoto` rows from `draftData`, generates `submissionRef`, sets `status=pending_review`, `submittedAt=now()`, clears `draftData`/`draftStep`, emits `hotel.onboarding.submitted`. |
| GET | `/properties/:id/status` | Returns `{ status, submissionRef, submittedAt, revisionCount, revisionNotes, timeline }`. `timeline` is derived (Submitted/Under Review/Decision/Live entries with timestamps). |
| PATCH | `/properties/:id/revise` | Only valid when `status=needs_revision`. Re-runs step validation, re-materializes changed steps, sets `status=pending_review`, emits `hotel.onboarding.submitted` (resubmission). Does NOT increment `revisionCount` (M2B does that on each revision *request*, not on resubmission). |

## 4. Edge cases & validation rules

1. **Ownership**: every endpoint except `POST /properties/draft` must verify
   the caller has `UserPropertyRole(propertyId, OWNER)`. 403 otherwise.
2. **Step number range**: `stepNum` must be 1-5 (`ParseIntPipe` + range
   check) → 400 `Invalid step number`.
3. **Step ordering**: steps may be saved out of order (per spec, auto-save on
   each "Save & Continue", but owner can navigate back). `draftStep` tracks
   the *highest* step reached, not the last saved.
4. **Draft mutability after submission**: `PATCH /properties/:id/step/:n` on
   a property with `status` in `(pending_review, approved)` → 409 Conflict
   ("Cannot edit while under review/approved" — approved edits go through a
   different endpoint in a later module). `needs_revision` and `draft` are
   editable.
5. **Submission completeness**: `POST /submit` validates each of steps 1-5
   against their Zod-equivalent class-validator DTOs (server-side mirror of
   `payperhour-next/modules/owner/schemas/index.ts`). Missing/invalid step →
   400 with `{ step, errors }`.
6. **Conditional fields**:
   - `minBookingHours` required only if `bookingPolicy != 'fullday'`.
   - `fulldayRate` required per room type only if `bookingPolicy != 'hourly'`.
   - `hourlyRate` required per room type only if `bookingPolicy != 'fullday'`.
   - `seatingCapacity` required only if `propertyType == 'banquet'`.
   - FSSAI document required only if amenities include an FSSAI-triggering
     entry (see `REQUIRES_FSSAI` in `amenities.ts`).
   - Pool safety cert required only if amenities include a pool entry
     (`REQUIRES_POOL_SAFETY`).
   - Fire safety cert is **always required** (per spec section 3.2 Step 5).
7. **GSTIN dedup**: `lookupHash(gstin)` must be unique across
   `PropertyComplianceDoc` rows EXCEPT the row belonging to the same
   `propertyId` (re-saving step 5 for the same draft is allowed). Conflict →
   409 "This GSTIN is already registered with another property."
8. **GSTIN/PAN format**: validated via the same regexes as
   `step5Schema` (15-char GSTIN, 10-char PAN). IFSC: `^[A-Z]{4}0[A-Z0-9]{6}$`.
9. **Bank details change after approval**: out of scope for M1 (Profile &
   Settings module), but the encryption/storage model must support updates —
   `PATCH /properties/:id/step/5` upserts `PropertyComplianceDoc`.
10. **Revision cycle cap**: `revisionCount >= 3` → `status` should be set to
    a terminal `escalated`-like state by M2B (M1 doesn't transition into it,
    but `PropertyStatus` enum should NOT need to grow for M1 — `suspended`
    can be reused, or M2B's spec adds its own value later. **Decision**: leave
    `PropertyStatus` enum exactly as listed above for M1; M2B Gate 0 may add
    `escalated` via additive migration).
11. **Draft expiry**: `draftData`/`draft` rows older than 90 days with
    `status=draft` should be eligible for cleanup. M1 does not implement the
    cron (tracked separately for M2/notification reminders), but
    `Property.updatedAt` is sufficient to compute eligibility later — no
    extra column needed.
12. **Idempotent draft creation**: `POST /properties/draft` always creates a
    new `Property` (multi-property owners are allowed per spec section 4.1
    "List Another Property"). No dedup needed.
13. **Money representation**: rates stored as integer paise (`hourlyRatePaise`,
    `fulldayRatePaise`) to match `BookingCreatedPayload.amountPaise` from
    `domain-events.ts` and avoid floating-point rounding bugs. DTOs accept
    rupees (numbers, as the frontend zod schema does) and the service
    converts ×100.
14. **Photo limits**: 1-5 per category, 25 total, enforced server-side
    regardless of client-side checks.
15. **Masking on read**: `GET /properties/:id/draft` and any future profile
    endpoints must return `maskValue(gstin, {keepStart:2, keepEnd:5})` etc. —
    never plaintext GSTIN/PAN/bank account number outside of internal
    decrypt-on-demand flows (none exist in M1).

## 5. Events emitted

- `hotel.onboarding.submitted` → `{ hotelId, ownerId, submissionRef }` (extend
  `HotelOnboardingSubmittedPayload` in `domain-events.ts` if the existing
  shape doesn't carry `submissionRef`).

## 6. Out-of-scope follow-ups (tracked as separate tasks)

- Photo upload pipeline (S3 presigned URLs) — M1 DTOs accept `url: string`
  for now; replace with presigned-upload flow when storage is provisioned.
- `owner_notifications` table + inbox endpoints — M2.
- GSTIN/IFSC third-party validation — Sprint 5 equivalent, deferred.
- Admin approve/reject/request-revision — M2B.

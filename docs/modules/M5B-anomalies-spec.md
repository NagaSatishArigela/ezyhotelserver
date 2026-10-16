# M5B: Anomalies (Pattern Detection) — Gate 0 Spec Lock

Status: LOCKED for Gate 1 implementation
Source: `Booking_Operations_Module_Spec.docx` (PayPerHour, March 2026) §4
(Anomalies Tab — Pattern Detection: §4.1 Detection Engine, §4.1.1 Rule
Definitions ANO-001..010, §4.1.2 Anomaly Lifecycle, §4.2 Anomaly List View,
§4.3 Anomaly Detail Panel), §6 (`/admin/anomalies*` API), §7.1 (`anomalies`
table); `docs/modules/M5-admin-booking-operations-spec.md` §6 (out-of-scope
confirmation — this spec fulfils the M5B item); `docs/modules/M3-booking-engine-spec.md`
(`Booking` model, `booking-lifecycle.scheduler.ts` cron pattern);
`docs/modules/M4-property-search-discovery-spec.md` (cross-schema raw-SQL
read pattern).

## 1. Scope boundary

§4 describes a two-phase detection engine (Phase 1 rule-based, Phase 2
ML-based) covering 10 rules (ANO-001..010), full evidence rendering per rule
type, an "Escalate → internal ops ticket" flow, and links to "suspend hotel" /
"block user" actions. As with M4/M5, this spec ships the **highest-value,
lowest-risk slice** that the current schema and modules can support without
new infrastructure (no device-fingerprinting, no rate-history table, no
ticketing system, no ML).

| In scope (M5B) | Deferred (later) |
|---|---|
| `anomalies` table (§7.1, trimmed — see §2.1) | ML-based detection (Phase 2 per spec §4.1) |
| Background rule engine, `@Cron(EVERY_5_MINUTES)`, implementing **8 of 10** rules (§2.2) | **ANO-005 Price anomaly** — needs a rate-history table (no `RoomTypePriceHistory` exists); deferred until a pricing module captures rate changes |
| `GET /admin/anomalies` — filterable list | **ANO-008 Same device, multiple accounts** — needs device-fingerprinting infra (no `deviceId`/fingerprint captured anywhere); deferred to a fraud/trust module |
| `GET /admin/anomalies/:id` — detail + evidence + related entities | "Escalate" → real internal ops ticket — no ticketing system exists (same `future module` note as M2 §"escalated"); M5B's Escalate is a status transition + notes only |
| `PATCH /admin/anomalies/:id` — status transitions incl. auto `investigating` on first view | "Suspend hotel" / "Block user" quick actions — no suspension/ban mechanism exists on `Property`/`User` yet; M5B's quick actions are limited to the M5 booking actions (Void/Flag) that already exist |
| Anomalies tab in `ezyhotelsportal` (`AdminBookingsPage`, third tab alongside All Bookings / Active Now) | Severity-based push notifications / sound alerts (real-time, deferred per M5 §6) |
| RBAC: `ADMIN` / `SUPER_ADMIN` only (existing guards) | Cursor pagination at scale (offset pagination per M5 precedent) |

## 2. Data model

### 2.1 New table: `Anomaly` (`bookings` schema)

Trimmed from spec §7.1: `assigned_to` (admin ops queue assignment) is
deferred — M5B has no per-admin queue UI, so every unresolved anomaly is
visible to all admins. `resolution_type` free-text values are constrained to
the subset of §4.3's "Resolve as Action Taken" dropdown that maps to actions
M5B can actually perform (see §3.5).

```prisma
model Anomaly {
  id         String         @id @default(uuid()) @db.Uuid
  ruleId     String         @map("rule_id")          // 'ANO-001'..'ANO-010'
  severity   AnomalySeverity
  entityType AnomalyEntityType @map("entity_type")
  entityId   String         @map("entity_id") @db.Uuid // FK-less: property/user/booking id (cross-schema)
  description String        @db.Text                  // auto-generated, see §3.3
  evidence   Json                                       // structured, per-rule shape (§2.4)
  status     AnomalyStatus  @default(detected)
  resolutionType  String?   @map("resolution_type")    // see §3.5 enum
  resolutionNotes String?   @map("resolution_notes") @db.Text
  resolvedBy String?        @map("resolved_by") @db.Uuid // cross-schema: auth.User.id
  detectedAt DateTime       @default(now()) @map("detected_at")
  resolvedAt DateTime?      @map("resolved_at")

  @@index([status, severity])
  @@index([ruleId, entityType, entityId])
  @@map("anomalies")
  @@schema("bookings")
}

enum AnomalySeverity {
  critical
  high
  medium
  low

  @@schema("bookings")
}

enum AnomalyEntityType {
  property   // spec's "hotel"
  customer
  booking

  @@schema("bookings")
}

enum AnomalyStatus {
  detected
  investigating
  resolved_action
  resolved_fp
  escalated

  @@schema("bookings")
}
```

Notes:
- **`entity_type: property`** (not `hotel`) — matches the existing
  `properties.Property` model naming used throughout `ezyhotelsserver`
  (`Booking_Operations_Module_Spec.docx` uses "hotel" colloquially; M4/M5 both
  use `property`).
- `entityId` is a plain UUID, no Prisma relation, per the modular-monolith
  isolation rule (same as `BookingAdminAction.bookingId`).
- Table lives in the `bookings` schema (not a new `ops`/`anomalies` schema)
  — every implemented rule's evidence is booking-derived, and it shares the
  `BookingAdminAction` audit trail for "resolved_action" quick actions.

### 2.2 Rule engine — `AnomalyDetectionScheduler`

New `@Cron(CronExpression.EVERY_5_MINUTES)` job in
`modules/bookings/admin/anomaly-detection.scheduler.ts`, following
`booking-lifecycle.scheduler.ts`'s pattern (thin scheduler delegating to a
service method per rule, logging only when anomalies are created).

| Rule | Logic (query against `bookings.Booking`) | Severity | Window | Threshold |
|---|---|---|---|---|
| ANO-001 High cancellation rate | Per `propertyId`: `COUNT(status IN (cancelled, voided)) / COUNT(*)` over window | medium | 7 days | > 30% (min 5 bookings in window, to avoid noise on low-volume properties) |
| ANO-002 Payment failure spike | Per `propertyId`: `COUNT(paymentStatus = failed)` over window | high | 1 hour | > 5 |
| ANO-003 Overbooking detected | Self-join: two bookings, same `roomTypeId`, `status IN (confirmed, checked_in)`, overlapping `[checkInAt, checkOutAt)` | critical | real-time (every run scans unresolved overlaps) | any occurrence |
| ANO-004 Suspicious booking velocity | Per `guestId`: `COUNT(*)` of bookings with `createdAt` in window | medium | 24 hours | > 5 |
| ANO-006 No-show cluster | Per `propertyId`: `COUNT(status = no_show)` with `noShowAt` in window | medium | 24 hours | > 3 |
| ANO-007 Late-night spike | Per `propertyId`: `COUNT(*)` of bookings with `createdAt` hour in `[23:00, 05:00)` over window | low | 6 hours | > 10 (flat threshold per spec; "unusual" baseline comparison is the ML Phase-2 refinement, out of scope) |
| ANO-009 Refund abuse | Per `guestId`: `COUNT(refundAmountPaise > 0) / COUNT(*)` over window (min 5 bookings) | high | 90 days | > 40% |
| ANO-010 Manual flag | Every `Booking` with `isFlagged = true` that doesn't already have an **unresolved** ANO-010 anomaly for it | varies — `medium` (matches `flagType` severity is not modelled; flat `medium`) | n/a | n/a, fires once per flag |

**Dedup rule** (applies to all 8): before inserting, check for an existing
`Anomaly` with the same `ruleId` + `entityType` + `entityId` and
`status IN (detected, investigating)`. If found, skip (don't create a
duplicate) — the existing unresolved anomaly already represents the ongoing
issue. Re-fires only after the prior anomaly is resolved (any
`resolved_*`/`escalated` status) and the condition recurs.

### 2.3 Cross-schema reads (raw SQL, read-only — M4/M5 pattern)

List/detail need `Property.name`/`city` (for `entity_type = property`) and
`User.phone` (for `entity_type = customer`, same "no `name` field" caveat as
M5 §2.3) and `Booking.bookingRef` (for `entity_type = booking` and for
evidence rows). A new `AnomaliesRepository` builds `Prisma.$queryRaw` joins
across `bookings.anomalies`, `bookings.bookings`, `properties.properties`,
and `auth.users` — list/detail only, same constraints as M5's
`AdminBookingsRepository`.

### 2.4 Evidence shapes (per rule, stored in `Anomaly.evidence` JSON)

| Rule | `evidence` shape |
|---|---|
| ANO-001 | `{ cancelledCount, totalCount, rate, windowDays, sampleBookingIds: string[] }` (up to 10) |
| ANO-002 | `{ failedCount, windowHours, sampleBookingIds: string[] }` |
| ANO-003 | `{ bookingIdA, bookingIdB, roomTypeId, overlapStart, overlapEnd }` |
| ANO-004 | `{ bookingCount, windowHours, bookingIds: string[] }` |
| ANO-006 | `{ noShowCount, windowHours, bookingIds: string[] }` |
| ANO-007 | `{ bookingCount, windowHours, bookingIds: string[] }` |
| ANO-009 | `{ refundedCount, totalCount, rate, windowDays, sampleBookingIds: string[] }` |
| ANO-010 | `{ bookingId, flagType, flagNotes }` |

Detail endpoint (§3.4) resolves `sampleBookingIds`/`bookingIds`/`bookingIdA`/
etc. into `{ id, bookingRef, status, totalAmountPaise, checkInAt, checkOutAt }`
summaries for the evidence table.

## 3. API contract

All endpoints: `@UseGuards(JwtAuthGuard, RolesGuard)` +
`@Roles(GlobalRole.ADMIN, GlobalRole.SUPER_ADMIN)`, mounted under
`/admin/anomalies`.

### 3.1 `GET /admin/anomalies`

| Param | Type | Notes |
|---|---|---|
| `severity` | comma-separated `AnomalySeverity[]` | |
| `ruleId` | string | exact match, e.g. `ANO-001` |
| `status` | comma-separated `AnomalyStatus[]` | default: all except none (no default filter — spec's tab badge counts `detected`+`investigating`, but the list itself shows everything unless filtered) |
| `dateFrom`, `dateTo` | ISO date | filters on `detectedAt` |
| `propertyId` | UUID | filters `entityType = property AND entityId = :propertyId` |
| `customerId` | UUID | filters `entityType = customer AND entityId = :customerId` |
| `page`, `limit` | int | `limit` default 50, max 100 |
| `sort` | `severity \| detectedAt \| status` | default `severity` (critical → low, per §4.2) |
| `order` | `asc \| desc` | default `desc` |

Response: `{ items: AdminAnomalyListItem[], total, page, limit }` where
`AdminAnomalyListItem` = anomaly core fields + `entityLabel` (property name /
guest phone / booking ref, resolved via §2.3 joins).

### 3.2 `GET /admin/anomalies/unresolved-count`

Returns `{ count: number }` — `COUNT(*) WHERE status IN (detected,
investigating)`. Powers the Anomalies tab badge (§4.2 "Unresolved anomalies
are counted in the tab badge"). Polled by the frontend on a 60s interval
(no WebSocket, consistent with M5's Active Now polling).

### 3.3 `GET /admin/anomalies/:id`

Returns:

```ts
{
  anomaly: Anomaly;
  entity: { type: 'property' | 'customer' | 'booking'; id: string; label: string; href: string };
  evidence: ResolvedEvidence; // §2.4 shapes with bookingIds expanded to summaries
  relatedActions: BookingAdminAction[]; // M5's audit log entries for booking(s) referenced in evidence, most recent first
}
```

Side effect: if `status = detected`, this call transitions it to
`investigating` (§4.1.2 "Set automatically when admin views detail") and sets
nothing else. Idempotent — viewing an `investigating` anomaly again is a
no-op.

**Auto-generated `description`** (written at detection time, §2.2): a fixed
template per rule, e.g.:

- ANO-001: `"{propertyName} had {cancelledCount} cancellations out of {totalCount} bookings in the last {windowDays} days ({rate}% cancellation rate, threshold: 30%)."`
- ANO-003: `"Bookings {refA} and {refB} both reserve room type {roomTypeId} with overlapping dates ({overlapStart} – {overlapEnd})."`
- ANO-010: `"Booking {bookingRef} was manually flagged ({flagType}): {flagNotes}"`

(Full template list for all 8 rules included in Gate 1 implementation; this
spec fixes the *shape*, not every string.)

### 3.4 `PATCH /admin/anomalies/:id`

Body: `{ status: AnomalyStatus; resolutionType?: string; resolutionNotes?: string }`

| Target status | Pre-condition (else 409) | Effect |
|---|---|---|
| `investigating` | `status = detected` | (also reachable via the auto-transition in §3.3; explicit PATCH is allowed for completeness) |
| `resolved_action` | `status IN (detected, investigating)` | requires `resolutionType` (enum, §3.5) and `resolutionNotes`; sets `resolvedBy = adminId`, `resolvedAt = now` |
| `resolved_fp` | `status IN (detected, investigating)` | requires `resolutionNotes` (spec: "notes required, contributes to rule tuning"); sets `resolvedBy`, `resolvedAt` |
| `escalated` | `status IN (detected, investigating)` | requires `resolutionNotes`; sets `resolvedBy`, `resolvedAt`. **No ticket is created** (§1 deferred) — this is a terminal status meaning "handed off outside the system" |

Returns the updated `Anomaly`. Re-`PATCH`-ing an already-resolved/escalated
anomaly to any status → `409 Conflict`, "This anomaly has already been
resolved."

### 3.5 `resolutionType` enum (subset of spec §4.3's dropdown)

```ts
type AnomalyResolutionType =
  | 'voided_booking'   // admin used M5's POST /admin/bookings/:id/void on the relevant booking
  | 'flagged_for_review' // admin used M5's POST /admin/bookings/:id/flag
  | 'contacted_owner'  // no system action — notes only
  | 'no_action_needed' // reviewed, nothing to do (distinct from false-positive: admin agrees it happened but accepts it)
  | 'other'
```

`suspended_hotel` / `blocked_user` / `adjusted_inventory` from the spec's
dropdown are **not** offered — no suspension/ban/inventory-adjustment
mechanism exists (§1). If an admin needs those outcomes today, they pick
`other` and describe the manual action taken in `resolutionNotes`.

### 3.6 No new domain events

Anomaly detection and resolution do not emit notification events in M5B —
anomalies are an internal admin-ops concern, not guest/owner-facing. (If a
future module needs to notify an owner about e.g. ANO-001, that's a new
event added then.)

## 4. Frontend (`ezyhotelsportal`)

- Extend `adminBookingsSearchSchema.tab` from `['list', 'active']` to
  `['list', 'active', 'anomalies']` — Anomalies becomes a third tab on the
  existing `/admin/bookings` page (matches spec's "4-tab admin dashboard"
  framing; Disputes remains the separate `/admin/disputes` placeholder route
  for M6).
- New `src/lib/api/adminAnomalies.ts` — `list()`, `unresolvedCount()`,
  `getDetail()`, `updateStatus()`, following `adminBookings.ts`'s pattern
  (typed responses mirroring §3).
- Tab bar: "Anomalies" label with a badge showing `unresolvedCount()` (60s
  poll), matching the sidebar's existing badge-on-nav-item convention
  (`AdminShell.tsx`'s `disputes` badge).
- `AnomaliesView` (sibling to M5's `ActiveBookingsView`): table with columns
  per §4.2 (anomaly ID, rule, severity badge, entity, description, detected
  at, status, actions), filter bar (severity multi-select, rule, status
  multi-select, date range — reuse `StatusMultiSelect`-style components from
  M5), sorted by severity desc by default. Severity badges: critical = red
  (pulsing via existing `Badge` `variant="red"` + a CSS pulse class), high =
  orange, medium = amber, low = gray.
- Anomaly detail: reuse M5's drawer/slide-over primitive. Sections: header
  (rule, severity badge, status badge), description, evidence table (rows
  from §3.3's resolved evidence, each row links to
  `/admin/bookings?bookingRef=...` to open that booking's M5 detail drawer),
  investigation notes textarea, and 3 action buttons: "Resolve — Action
  Taken" (dropdown per §3.5 + notes), "Resolve — False Positive" (notes,
  required), "Escalate" (notes, required) — each a confirmation dialog
  matching M5's `ActionDialog` pattern.
- "Quick actions" from §4.3 ("direct links to ... void booking") become: for
  `entityType = booking` anomalies, a "View booking" button that opens the
  M5 booking detail drawer (where Void/Flag already live) — no duplicate
  action buttons in the anomaly drawer itself.

## 5. Edge cases (scoped to M5B)

| Scenario | Behaviour |
|---|---|
| Rule engine run overlaps with a previous still-running run (long query) | NestJS `@Cron` is sequential per-process by default; if scale becomes a concern, a future module adds a lock. Not handled in M5B (matches `booking-lifecycle.scheduler.ts`'s current lack of overlap protection). |
| `PATCH` to `resolved_action` without `resolutionType` | `400 Bad Request` (DTO validation). |
| `PATCH` to `resolved_fp` / `escalated` without `resolutionNotes` | `400 Bad Request`, "Notes are required to resolve this anomaly." |
| `GET /admin/anomalies/:id` for a non-existent id | `404 Not Found`. |
| ANO-003 (overbooking) detected, but one of the two bookings is later cancelled before the anomaly is resolved | Anomaly remains `detected`/`investigating` until an admin explicitly resolves it — the rule engine does not auto-resolve anomalies (no "condition no longer true → auto-close" logic in M5B; admin must close the loop, consistent with §4.1.2's lifecycle being admin-driven). |
| ANO-010 (manual flag) for a booking that gets `unflag`'d before the anomaly is reviewed | Same as above — anomaly stays open; description still references the flag that existed at detection time. Admin can resolve as `resolved_fp` if the flag was removed because it was a mistake. |
| `severity`/`status`/`ruleId` filter values that don't match the enum | `400 Bad Request` (DTO validation, same pattern as M5's `status` filter). |
| Two admins `PATCH` the same anomaly simultaneously | Optimistic guard: `UPDATE ... WHERE id = :id AND status IN (...)` — second request affects 0 rows → `409 Conflict`, "This anomaly has already been resolved." (mirrors M5's `updateIfStatus`). |

## 6. Out-of-scope confirmation (for future planning)

- **ANO-005 (Price anomaly)**: needs a rate-history table — revisit once a
  pricing/rate-management module exists.
- **ANO-008 (Device fingerprinting)**: needs a fraud/trust module capturing
  device IDs at signup/booking time.
- **ML-based detection (Phase 2)**: explicitly phase-2 in the spec; M5B is
  Phase 1 (rule-based) only.
- **Real ticketing for "Escalate"**: same `future module` note as M2's
  `escalated` notification status — needs a dedicated ops-ticketing system.
- **Suspend hotel / Block user**: needs suspension/ban fields on
  `Property`/`User` plus enforcement in auth/booking flows — a trust & safety
  module.
- **M6 — Disputes**: unchanged from M5 §6, still its own Gate 0 spec.

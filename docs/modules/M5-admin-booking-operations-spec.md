# M5: Admin Booking Operations (All Bookings + Admin Actions) — Gate 0 Spec Lock

Status: LOCKED for Gate 1 implementation
Source: `Booking_Operations_Module_Spec.docx` (PayPerHour, March 2026) §1-§2 (All
Bookings tab — KPI strip, filter bar, table, booking detail slide-over), §2.5
(admin actions: Void/Refund/Cancel/Force-Checkout/Extend/Flag), §2.5.2
(Void vs Cancel vs Refund decision guide), §3 (Active Now — read-only subset),
§6 (API), §7.3 (bookings table additions), §8 (edge cases — admin-action
subset); `docs/modules/M3-booking-engine-spec.md` (`Booking` model,
`BookingStatus`/`PaymentStatus` enums, overlap-check pattern, cancellation
refund calculation, lifecycle scheduler); `docs/modules/M4-property-search-discovery-spec.md`
(cross-schema raw-SQL read pattern); `ezyhotelsportal` admin shell/routes
(`src/routes/admin/bookings.tsx`, `src/pages/admin/AdminPortalPages.tsx`).

## 1. Scope boundary

`Booking_Operations_Module_Spec.docx` describes a 4-tab admin dashboard (All
Bookings, Active Now, Anomalies, Disputes) backed by Elasticsearch global
search, SNS/SQS-driven WebSocket real-time feeds, and a background rule-based
anomaly-detection engine. None of that infrastructure exists yet — same
constraint M4 hit for guest search.

Per product decision, M5 ships the **highest-value, lowest-risk slice**: the
**All Bookings** tab (KPI strip, filters, table, booking detail) plus the
**admin actions** that mutate the `Booking` model M3 introduced (void, cancel,
refund, force-checkout, extend, flag). **Active Now** is included as a
read-only filtered view of the same table (`status = checked_in`), refreshed
via polling — no WebSocket. **Anomalies** and **Disputes** are full tabs with
their own tables (`anomalies`, `disputes`) and lifecycles; they are deferred
to **M5B** (Anomalies) and **M6** (Disputes) as their own Gate 0 specs, per
the M3 §9 out-of-scope list.

| In scope (M5) | Deferred (M5B / M6 / later) |
|---|---|
| `GET /admin/bookings` — filterable list (date range, city, property, booking type, status[], amount range, guest phone/name, booking ref) | Elasticsearch-backed global search (`Cmd+K`) — M4 established the Postgres-first pattern; same applies here |
| `GET /admin/bookings/kpis` — 5 KPI cards (total bookings, GBV, cancellation rate, avg value, no-show rate) for the active filter set | CSV export (`GET /admin/bookings/export`) — needs streaming infra; flagged for a dedicated reporting module |
| `GET /admin/bookings/:id` — full detail incl. property/guest info and a derived status timeline | Refund History / Related Tickets / Guest Review sections of the detail panel — depend on a real payment-gateway refund table, a support-ticket system, and the Reviews module (none exist) |
| `GET /admin/bookings/active` — `status = checked_in` rows sorted by time-remaining, polled every 15s | WebSocket push (`booking.checked_in` / `booking.completed` / `booking.extended` live events), sound alerts |
| `POST /admin/bookings/:id/void` | Anomalies tab + `anomalies` table + rule engine (ANO-001..010) — **M5B** |
| `POST /admin/bookings/:id/cancel` (admin-initiated) | Disputes tab + `disputes` table + resolution flow — **M6** |
| `POST /admin/bookings/:id/refund` (full/partial — bookkeeping only, no live payment-gateway call, matching M3's mocked-payment pattern) | Real refund-gateway integration / "queued for retry on gateway-down" (§8) |
| `POST /admin/bookings/:id/force-checkout` | Payment Method filter — no `paymentMethod` field exists on `Booking` (only `paymentStatus`); deferred until a payments module captures it |
| `POST /admin/bookings/:id/extend` | Keyboard shortcuts, column visibility/resize persistence, virtualised TanStack table — nice-to-haves layered on later |
| `POST /admin/bookings/:id/flag` | "Contact Guest" / "Contact Hotel" / "Create Support Ticket" actions — need a messaging/ticketing system |
| Lightweight `BookingAdminAction` audit log (every action above) | Full reveal-logging for masked phone/email (no masking implemented yet — guest contact fields are shown as-is to admins, consistent with current `GET /admin/bookings/:id` access being admin-only) |
| RBAC: `ADMIN` / `SUPER_ADMIN` only (existing `JwtAuthGuard` + `RolesGuard` + `@Roles`) | — |

## 2. Data model

### 2.1 `Booking` model additions (`bookings` schema)

```prisma
model Booking {
  // ...existing M3 fields unchanged...

  voidedAt   DateTime? @map("voided_at")
  voidedBy   String?   @map("voided_by")   // admin user id
  voidReason String?   @map("void_reason")

  extensionAmountPaise Int? @map("extension_amount_paise")

  isFlagged Boolean @default(false) @map("is_flagged")
  flagType  String? @map("flag_type")  // suspicious | quality_issue | partner_complaint | other
  flagNotes String? @map("flag_notes")

  @@index([isFlagged])
}
```

Notes:
- **No `extended_checkout` shadow column.** `checkOutAt`/`durationHours` are
  updated in place by `extend` (single source of truth for availability
  checks); `extensionAmountPaise` records the most recent extension surcharge
  for display. The admin action log (below) preserves the before/after values
  for audit.
- **`voided` is a new `BookingStatus` value**, not reused `cancelled` — the
  decision guide (§2.5.2) treats Void as a distinct, stronger action
  ("auto-refunds, releases slot, logs as fraud") and M5B's anomaly rules need
  to distinguish voided-for-fraud from guest/admin cancellations.
- **`refunded` is a new `PaymentStatus` value**, not a `BookingStatus` value.
  A booking's lifecycle status (`completed`, `cancelled`, `voided`, etc.)
  is orthogonal to whether its payment was refunded — e.g. a `completed`
  booking can later have `paymentStatus = refunded` after a post-stay
  complaint resolution. `refundAmountPaise` (existing M3 field) records the
  amount.

```prisma
enum BookingStatus {
  pending_payment
  confirmed
  checked_in
  completed
  cancelled
  no_show
  voided   // new (M5)

  @@schema("bookings")
}

enum PaymentStatus {
  pending
  success
  failed
  refunded // new (M5)

  @@schema("bookings")
}
```

### 2.2 New table: `BookingAdminAction` (`bookings` schema)

A lightweight audit trail — every admin action in §4 writes one row here.
Full "Refund History" / "Related Tickets" / multi-actor status-timeline
sections from the spec are deferred (M5B/M6), but this table is the
foundation they'll build on.

```prisma
model BookingAdminAction {
  id        String   @id @default(uuid()) @db.Uuid
  bookingId String   @map("booking_id") @db.Uuid
  adminId   String   @map("admin_id") @db.Uuid
  action    BookingAdminActionType
  reasonCategory String? @map("reason_category")
  reasonText     String? @map("reason_text")
  metadata  Json?    // e.g. { amountPaise, newCheckOutAt, flagType }
  createdAt DateTime @default(now()) @map("created_at")

  @@index([bookingId])
  @@map("booking_admin_actions")
  @@schema("bookings")
}

enum BookingAdminActionType {
  void
  cancel
  refund_full
  refund_partial
  force_checkout
  extend
  flag
  unflag

  @@schema("bookings")
}
```

`bookingId` is a plain UUID column (no Prisma relation) per the modular-monolith
isolation rule — same pattern as `Booking.propertyId`/`guestId`.

### 2.3 Cross-schema reads (raw SQL, read-only — M4 pattern)

List/KPI/detail endpoints need `Property.name`/`city` (properties schema) and
`User.phone`/`email` (auth schema, for guest display name — derived as
`phone` since `User` has no `name` field). Following M4 §"raw SQL read-only
joins are acceptable for cross-schema reads", a new
`AdminBookingsRepository` builds `Prisma.$queryRaw` joins across
`bookings.bookings`, `properties.properties`, and `auth.users` for list/detail/KPI
queries only. No Prisma relation fields are added.

**Guest display name**: `User` has no `name` field (confirmed in
`auth.User` — only `phone`/`email`/`globalRole`/etc.). The spec's "Guest Name"
column/section displays `phone` (e.g. `+91 98765 43210`) instead of a name
until a profile/name field exists — noted as a known simplification, not a
blocker.

## 3. API contract

All endpoints: `@UseGuards(JwtAuthGuard, RolesGuard)` + `@Roles(GlobalRole.ADMIN, GlobalRole.SUPER_ADMIN)`, mounted under `/admin/bookings`.

### 3.1 `GET /admin/bookings`

| Param | Type | Notes |
|---|---|---|
| `dateFrom`, `dateTo` | ISO date | Filters on `checkInAt`. Default: last 7 days (matches spec default) |
| `city` | string | Exact match (case-insensitive) on `properties.city` |
| `propertyId` | UUID | Exact match |
| `bookingType` | `hourly \| fullday` | |
| `status` | comma-separated `BookingStatus[]` | |
| `amountMin`, `amountMax` | int (paise) | On `totalAmountPaise` |
| `guestPhone` | string | Partial match (min 3 chars), `auth.users.phone ILIKE` |
| `bookingRef` | string | Exact match |
| `page`, `limit` | int | `limit` default 50, max 100 (offset pagination — cursor pagination from the spec deferred; dataset is small enough at current scale) |
| `sort` | `createdAt \| checkInAt \| checkOutAt \| totalAmountPaise` | default `createdAt` |
| `order` | `asc \| desc` | default `desc` |

Response: `{ items: AdminBookingListItem[], total, page, limit }` where
`AdminBookingListItem` = booking core fields + `propertyName`, `city`,
`guestPhone`.

### 3.2 `GET /admin/bookings/kpis`

Same filter params as 3.1 (minus `page`/`limit`/`sort`/`order`). Returns:

```ts
{
  totalBookings: number;
  totalGbvPaise: number;        // SUM(totalAmountPaise)
  cancellationRate: number;     // 0-100, 2dp — COUNT(cancelled+voided)/COUNT(*)*100
  avgBookingValuePaise: number; // totalGbvPaise / totalBookings (0 if totalBookings = 0)
  noShowRate: number;           // 0-100, 2dp — COUNT(no_show)/COUNT(*)*100
}
```

### 3.3 `GET /admin/bookings/active`

No filters. Returns all `status = checked_in` bookings, sorted by `checkOutAt
ASC` (soonest-expiring first = "time remaining"). Each item includes
`timeRemainingSeconds` (computed: `checkOutAt - now`, can be negative if
overdue) and `isOverdue: boolean`. Same `AdminBookingListItem` shape plus
those two fields.

### 3.4 `GET /admin/bookings/:id`

Returns:

```ts
{
  booking: Booking;            // full Prisma row incl. M5 additions
  property: { id, name, city, area };
  guest: { id, phone, email };
  timeline: TimelineEntry[];    // derived, see §3.4.1
  adminActions: BookingAdminAction[]; // most recent first
}
```

#### 3.4.1 Derived status timeline

Built from existing `Booking` timestamp columns — no new timeline table
(full multi-actor timeline with payment-gateway events is deferred). Entries,
included only if the corresponding timestamp is non-null:

| Timestamp field | Timeline label |
|---|---|
| `createdAt` | "Created" |
| `checkedInAt` | "Checked In" |
| `checkedOutAt` | "Completed" (or "Force-Checked-Out" if a `force_checkout` admin action exists for this booking) |
| `cancelledAt` | "Cancelled" (label "Voided" if `status = voided`) — includes `cancelReason`/`voidReason` |
| `noShowAt` | "No-Show" |
| each `BookingAdminAction` row | action-specific label (e.g. "Refund — ₹500 (Partial)", "Extended to 8:00 PM", "Flagged: suspicious") |

Sorted by timestamp ascending.

### 3.5 Admin action endpoints

All return the updated `{ booking: Booking }` (with M5 fields) and write a
`BookingAdminAction` row. All use the existing `repo.updateIfStatus()`
optimistic-status-guard pattern (M3) — a status mismatch at write time throws
`ConflictException` (409), matching spec §8's race-condition handling.

| Endpoint | Body | Pre-condition (else 409) | Effect |
|---|---|---|---|
| `POST /:id/void` | `{ reasonCategory: 'fraud'\|'emergency'\|'duplicate'\|'hotel_request'\|'other', reasonText?: string }` | `status = confirmed` | `status → voided`, `voidedAt/voidedBy/voidReason` set, `refundAmountPaise = totalAmountPaise`, `paymentStatus → refunded`. Emits `BOOKING_VOIDED`. |
| `POST /:id/cancel` | `{ reasonCategory: 'guest_request'\|'hotel_request'\|'admin_decision'\|'system_error', reasonText?: string }` | `status = confirmed` | Same shape as guest cancel (M3 `BookingsService.cancel`) but `cancelledBy = 'admin:{adminId}'`. Refund calculated via M3's `calculateRefund()`. Emits `BOOKING_CANCELLED`. |
| `POST /:id/refund` | `{ amountPaise: number, reasonCategory, reasonText?: string }` | `status in (confirmed, checked_in, completed)` AND `amountPaise <= totalAmountPaise - (refundAmountPaise ?? 0)` (else 400) | `refundAmountPaise += amountPaise`, `paymentStatus → refunded`. Booking `status` unchanged (§2.1 design note). Emits `BOOKING_REFUNDED` with `{ amountPaise, isPartial }`. Logged as `refund_full` if cumulative refund = `totalAmountPaise`, else `refund_partial`. |
| `POST /:id/force-checkout` | `{ reasonText: string }` | `status = checked_in` | `status → completed`, `checkedOutAt = now`. If `now > checkOutAt`, `metadata.overstayMinutes` recorded on the action log (no auto-charge, per spec — "flagged for review"). Emits `BOOKING_CHECKED_OUT` (reuses M3 event; `at` = forced time). |
| `POST /:id/extend` | `{ newCheckOutAt: ISO string, extensionAmountPaise: number }` | `status = checked_in` AND new interval `[checkOutAt, newCheckOutAt)` passes the same room-availability check as `createBooking` (M3 overlap check, else 409 "This extension is not available — the room is booked for that time.") | `checkOutAt = newCheckOutAt`, `durationHours` recomputed, `extensionAmountPaise` set, `totalAmountPaise += extensionAmountPaise`. Emits `BOOKING_EXTENDED`. |
| `POST /:id/flag` | `{ flagType: 'suspicious'\|'quality_issue'\|'partner_complaint'\|'other', flagNotes?: string }` | none (any status) | `isFlagged = true`, `flagType`, `flagNotes` set. Logged as `flag`. Emits `BOOKING_FLAGGED`. |
| `POST /:id/unflag` | `{}` | `isFlagged = true` (else 409 "This booking is not flagged.") | `isFlagged = false`, `flagType = null`, `flagNotes = null`. Logged as `unflag`. |

### 3.6 New domain events

```ts
BOOKING_VOIDED: 'booking.voided'
BOOKING_REFUNDED: 'booking.refunded'
BOOKING_EXTENDED: 'booking.extended'
BOOKING_FLAGGED: 'booking.flagged'
```

Payloads follow the existing `BookingCancelledPayload`/`BookingCheckInOutPayload`
shapes (primitive ids + ISO timestamps), feeding the M2 notifications module
for guest/owner emails (templates added in Gate 1 alongside M3's existing
`booking.cancelled` templates — "Your booking was voided by the platform: {reason}"
/ "Your stay has been extended to {newCheckOutAt}").

## 4. Frontend (`ezyhotelsportal`)

- Fix `src/routes/admin/bookings.tsx` — currently renders the placeholder
  `AdminPropertiesPage` (copy-paste leftover). Point it at a new
  `AdminBookingsPage`.
- New `src/lib/api/adminBookings.ts` — `list()`, `kpis()`, `active()`,
  `getDetail()`, `void()`, `cancel()`, `refund()`, `forceCheckout()`,
  `extend()`, `flag()`, `unflag()`, following the `adminProperties.ts` pattern
  (typed responses mirroring §3).
- `AdminBookingsPage`: KPI strip (5 cards from §3.2), filter bar (date range
  preset + city + booking type + status multi-select + amount range +
  guest phone + booking ref — synced to URL search params, debounced 300ms),
  paginated table (50/page, sortable columns per §3.1), "Active Now" toggle/tab
  that switches the table to `GET /admin/bookings/active` with a 15s
  `setInterval` poll and a live counter banner ("N guests currently checked in").
- Booking detail: a slide-over/drawer (reuse existing drawer primitive if one
  exists in `components/ui`, else a simple fixed-position panel) showing the
  derived timeline, booking/property/guest summary, and a sticky action bar
  with buttons for the 6 actions in §3.5 — each opens a small confirmation
  dialog collecting the required reason/amount fields, matching §2.5.1's
  double-confirmation for refunds ("Are you sure? This action cannot be
  undone. Refund ₹X to guest?").
- Virtualised TanStack table, column resize/visibility persistence, and
  keyboard shortcuts are **not** implemented in M5 (deferred per §1) — a plain
  paginated `<table>` (same approach as `AdminPortalPages.tsx`'s existing
  `PropertiesTable`) is sufficient at current scale.

## 5. Edge cases (scoped to M5, from spec §8)

| Scenario | Behaviour |
|---|---|
| Admin tries to void a booking that was just checked in (race) | `updateIfStatus` returns null → `409 Conflict`, "This booking was just checked in by the guest. You can no longer void it." |
| Admin tries to refund more than remaining refundable amount | `400 Bad Request`, "Refund amount cannot exceed ₹X (remaining refundable balance)." |
| Two admins act on the same booking simultaneously | `updateIfStatus` row-guard — second request gets `409`. |
| Admin opens detail for a booking that doesn't exist | `404 Not Found`. |
| `extend` requested but new interval overlaps another booking for the same room | `409 Conflict`, "This extension is not available — the room is booked for that time." |
| Force-checkout a guest still mid-stay (before `checkOutAt`) | Allowed (admin override) — `metadata.overstayMinutes` is **negative/omitted** in this case; no special error. Frontend shows a confirm dialog ("This will mark the guest as checked out in the system...") but backend does not block it. |
| `flag` called on an already-flagged booking | Allowed — overwrites `flagType`/`flagNotes` (re-flagging with new info), still logs a new `flag` action row. |
| `unflag` called on a non-flagged booking | `409 Conflict`, "This booking is not flagged." |
| List/KPI query with `guestPhone` < 3 chars | `400 Bad Request` (DTO validation), matching spec's "Min 3 characters" rule. |
| `amountMin > amountMax` | `400 Bad Request`, "minAmount cannot exceed maxAmount." (same pattern as M4's `minPrice`/`maxPrice`) |

## 6. Out-of-scope confirmation (for M5B/M6 planning)

Confirmed deferred, each needing its own Gate 0 spec:

- **M5B — Anomalies**: `anomalies` table (§7.1), rule engine ANO-001..010
  (background job), Anomalies tab, "Resolve as Action Taken / False Positive /
  Escalate" flows. Can build on the `BookingAdminAction` audit log and the new
  `voided`/`is_flagged` fields introduced here (ANO-010 "Manual flag" maps
  directly to `isFlagged`).
- **M6 — Disputes**: `disputes` table (§7.2), Disputes tab, hotel-response
  workflow, dispute resolution actions (full/partial refund via the same
  `POST /:id/refund` introduced here, wallet credit — needs a wallet concept).
- **Reporting/Export**: CSV export, scheduled reports, cursor pagination at
  scale.
- **Real-time**: WebSocket "Active Now" push, sound alerts, SNS/SQS event bus.
- **Global search** (`Cmd+K`, Elasticsearch): follows M4's precedent — Postgres
  `ILIKE`/trigram first, ES later without contract changes.
- **Guest profile name field**: `auth.User` has no `name` — guest display
  currently falls back to `phone`. Adding `name` is a small `auth` schema
  change but out of scope for M5 (not blocking).

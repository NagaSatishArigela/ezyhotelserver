# M6: Disputes (Post-Checkout Resolution) — Gate 0 Spec Lock

Status: LOCKED for Gate 1 implementation
Source: `Booking_Operations_Module_Spec.docx` (PayPerHour, March 2026) §5
(Disputes tab — lifecycle, list view, detail panel, resolution actions), §6
(API — `/admin/disputes*`), §7.2 (`disputes` table); `docs/modules/M5-admin-booking-operations-spec.md`
(§6 "Out-of-scope confirmation" — M6 deferral note, `BookingAdminAction`/
`updateIfStatus` patterns, refund calculation); `docs/modules/M5B-anomalies-spec.md`
(§2.2 rule engine pattern, `AnomalyStatus.escalated` precedent);
`docs/modules/M3-booking-engine-spec.md` (`Booking` model, lifecycle
scheduler pattern, `PPH-B-NNNNN` ref convention).

## 1. Scope boundary

`Booking_Operations_Module_Spec.docx` §5 describes the Disputes tab as a
guest-initiated complaint flow with a 7-day resolution SLA, a 48-hour
hotel-response window, and 5 resolution actions (full refund, partial refund,
no refund, wallet credit, escalate). Two cross-portal surfaces are implied:
**admin** (review/resolve, in `quicknestportal`'s Admin shell) and **hotel
owner** (respond to disputes against their property, in `quicknestportal`'s
Owner shell — this is new owner-portal surface area, M1-M5B were admin-only
additions).

Per product decision, M6 ships the full lifecycle end-to-end (filing →
admin review → hotel response → resolution/auto-close) rather than an
admin-only slice, because the lifecycle cannot be meaningfully tested without
both sides. Two genuinely new concepts are introduced, scoped to their
smallest useful form: a **wallet credit ledger** (flagged as a gap by M5B
§6/M5 §6 — MVP: append-only ledger, no spend/redemption) and a **dispute
filing endpoint** (no customer-facing app exists yet in this build —
`payperhour-next` is out of scope here, same as M3's "mocked payment"
precedent: the backend contract is real, a UI consumer can follow later).

| In scope (M6) | Deferred (future module) |
|---|---|
| `POST /bookings/:id/disputes` — guest files a dispute on a completed booking, within 48h of `checkedOutAt` | Guest-facing filing UI in `payperhour-next` |
| `GET /admin/disputes` — filterable list (status, category, date range, property, cursor) | Elasticsearch global search (`Cmd+K`) — same Postgres-first precedent as M4/M5/M5B |
| `GET /admin/disputes/unresolved-count` — Disputes tab badge | CSV export / scheduled reports — M5 §6 "dedicated reporting module" |
| `GET /admin/disputes/:id` — detail incl. booking/guest/property context, guest's prior disputes, property's prior disputes | "Listing photos vs guest's complaint photos side-by-side" gallery comparison — needs media storage infra (no S3/upload pipeline exists); evidence fields accept URL strings only |
| `POST /admin/disputes/:id/request-response` — opens 48h hotel-response window | Real email/SMS delivery — in-app notification only (M2 precedent: `owner_notifications` inbox) |
| `PATCH /admin/disputes/:id/resolve` — 5 resolution actions incl. wallet credit & escalate | Wallet redemption/spend at checkout — ledger is write-only in M6 |
| `POST /disputes/:id/hotel-response` — owner/manager submits response (new Owner-portal surface) | Ops queue / "assigned to" reassignment — M5B §6 same deferral |
| `wallet_credits` ledger table (minimal: who, how much, why, source dispute) | Dispute reassignment, ops escalation triage UI — `resolved status = escalated` is a terminal state with internal notification only, same as M5B's `escalated` |
| Auto-close cron: 7-day SLA → `closed_no_response`, guest-favour full refund | Per-category SLA tuning (spec's 48h is for hotel response only; 7-day overall SLA is fixed in M6) |
| New anomaly rule **ANO-011** (>5 guest-favour resolutions/30d → flags property) — small additive change to M5B's `AnomalyDetectionScheduler` | ANO-005 (price anomaly), ANO-008 (device fingerprint) — unchanged M5B deferrals |
| RBAC: filing = `USER` (must be `booking.guestId`); admin actions = `ADMIN`/`SUPER_ADMIN`; hotel-response = `PropertyRole.OWNER`/`MANAGER` on `dispute.propertyId` (existing `PropertyRoleGuard`) | Suspend/ban hotel after repeated guest-favour losses — M5B §6 "trust & safety module" |

## 2. Data model

### 2.1 New table: `Dispute` (`bookings` schema)

Field names follow M5/M5B conventions: `propertyId` (not "hotel"),
`guestId` (matches `Booking.guestId`), `*Paise` for money. `category` and
`requestedResolution` map directly to spec §5.2/§5.3; `status` extends the
spec's 7-value lifecycle (§5.1) with `resolved_wallet_credit` and `escalated`
— the spec's `resolution_type` enum (`wallet_credit`, `escalated`) has no
corresponding terminal `status` value, the same gap M5B resolved by adding
`AnomalyStatus.escalated` beyond the base "resolved_action/resolved_fp" pair.

```prisma
model Dispute {
  id          String   @id @default(uuid()) @db.Uuid
  disputeRef  String   @unique @map("dispute_ref")   // 'PPH-D-00001'
  bookingId   String   @map("booking_id") @db.Uuid    // FK-less -> bookings.Booking.id
  guestId     String   @map("guest_id") @db.Uuid      // FK-less -> auth.User.id
  propertyId  String   @map("property_id") @db.Uuid   // FK-less -> properties.Property.id

  category            DisputeCategory
  description         String  @db.Text
  guestEvidence       Json?   @map("guest_evidence")        // string[] of URLs
  requestedResolution DisputeRequestedResolution @map("requested_resolution")

  hotelResponse        String?   @map("hotel_response") @db.Text
  hotelEvidence        Json?     @map("hotel_evidence")      // string[] of URLs
  hotelResponseDeadline DateTime? @map("hotel_response_deadline")

  status         DisputeStatus @default(filed)
  resolutionType DisputeResolutionType? @map("resolution_type")
  refundAmountPaise Int?  @map("refund_amount_paise")
  adminNotes     String? @map("admin_notes") @db.Text
  resolvedBy     String? @map("resolved_by") @db.Uuid // FK-less -> auth.User.id

  filedAt            DateTime @default(now()) @map("filed_at")
  resolutionDeadline DateTime @map("resolution_deadline")   // filedAt + 7 days
  resolvedAt         DateTime? @map("resolved_at")

  @@index([status])
  @@index([bookingId])
  @@index([propertyId, status])
  @@map("disputes")
  @@schema("bookings")
}

enum DisputeCategory {
  room_quality
  cleanliness
  amenities
  staff
  safety
  charges
  other

  @@schema("bookings")
}

enum DisputeRequestedResolution {
  full_refund
  partial_refund
  credit
  apology

  @@schema("bookings")
}

enum DisputeStatus {
  filed
  under_review
  awaiting_hotel_response
  resolved_guest
  resolved_hotel
  resolved_partial
  resolved_wallet_credit
  escalated
  closed_no_response

  @@schema("bookings")
}

enum DisputeResolutionType {
  full_refund
  partial_refund
  wallet_credit
  no_action
  escalated

  @@schema("bookings")
}
```

`disputeRef` follows `Booking.generateBookingRef`'s pattern:
`PPH-D-${String(count + 1).padStart(5, '0')}`.

### 2.2 New table: `WalletCredit` (`wallet` schema — new schema)

Minimal append-only ledger per §1's wallet-credit deferral. No balance
column; balance = `SUM(amountPaise)` per `userId` if/when a redemption module
needs it.

```prisma
model WalletCredit {
  id         String   @id @default(uuid()) @db.Uuid
  userId     String   @map("user_id") @db.Uuid        // FK-less -> auth.User.id (guest)
  amountPaise Int     @map("amount_paise")
  reason     String   @db.Text                         // e.g. "Dispute PPH-D-00001 resolution"
  sourceType WalletCreditSourceType @map("source_type")
  sourceId   String   @map("source_id") @db.Uuid       // -> disputes.id
  createdBy  String   @map("created_by") @db.Uuid      // FK-less -> auth.User.id (admin)
  createdAt  DateTime @default(now()) @map("created_at")

  @@index([userId])
  @@map("wallet_credits")
  @@schema("wallet")
}

enum WalletCreditSourceType {
  dispute

  @@schema("wallet")
}
```

### 2.3 `NotificationType` additions (`notifications` schema)

Two values added to the existing enum (M2), reusing the `owner_notifications`
inbox for the two owner-facing dispute events. No guest-facing notification
inbox exists (same gap noted across M1-M5B) — guest-facing outcomes are
visible only via the (future) customer app reading `GET /bookings/:id` +
`disputes` once exposed there; out of scope for M6's API surface.

```prisma
enum NotificationType {
  // ...existing values...
  dispute_response_requested
  dispute_resolved
}
```

- `dispute_response_requested` — sent to the property's `OWNER` on
  `POST /admin/disputes/:id/request-response`.
- `dispute_resolved` — sent to the property's `OWNER` when resolution has a
  payout impact (`resolved_guest`, `resolved_partial`, `closed_no_response`)
  or when escalated.

### 2.4 Cross-schema reads (raw SQL, read-only — M4/M5/M5B pattern)

`GET /admin/disputes` (list) and `GET /admin/disputes/:id` (detail) join
`disputes` with `bookings.Booking` (booking ref, dates, amounts),
`properties.Property` (name, city), and `auth.User` (guest phone — same
fallback as M5B since `auth.User` has no `name` field) via raw SQL, mirroring
`AdminAnomaliesRepository`'s pattern.

`GET /admin/disputes/:id`'s "guest's booking history" and "hotel's dispute
history" (spec §5.3 sections A/B) are computed with two extra count queries
against `disputes` (`guestId` / `propertyId`), not full history payloads —
keeps the detail endpoint to a single round trip plus 2 scalar counts.

## 3. API contract

### 3.1 `POST /bookings/:id/disputes`

Role: `USER`, and `req.user.id === booking.guestId`.

Body: `{ category: DisputeCategory, description: string, requestedResolution: DisputeRequestedResolution, evidence?: string[] }`

Preconditions:
- `booking.status === 'completed'`
- `now <= booking.checkedOutAt + 48h`
- No existing dispute for this `bookingId` (one dispute per booking — see §5)

On success: creates `Dispute` with `status = filed`,
`resolutionDeadline = now + 7 days`, `disputeRef = PPH-D-NNNNN`. Returns the
created `Dispute`.

### 3.2 `GET /admin/disputes`

Role: `ADMIN`/`SUPER_ADMIN`. Query params (spec §6): `status?`, `category?`,
`dateFrom?`, `dateTo?`, `propertyId?`, `page` (default 1), `limit` (default
50, max 100). Default sort: `resolutionDeadline asc` (soonest deadline
first, per spec §5.2 "ensure no dispute expires unresolved").

Returns: `{ items: AdminDisputeListItem[], total, page, limit }` where each
item includes `disputeRef`, `bookingRef`, `guestPhone`, `propertyName`,
`category`, `filedAt`, `resolutionDeadline`, `status`,
`hoursUntilDeadline` (derived, for the red-when-<24h countdown).

### 3.3 `GET /admin/disputes/unresolved-count`

Role: `ADMIN`/`SUPER_ADMIN`. Returns `{ count }` —
`status IN (filed, under_review, awaiting_hotel_response)`. Same shape as
M5B's `/admin/anomalies/unresolved-count`, for the Disputes tab badge.

### 3.4 `GET /admin/disputes/:id`

Role: `ADMIN`/`SUPER_ADMIN`. First view auto-transitions `filed` →
`under_review` (same auto-transition precedent as M5B's
`detected` → `investigating`).

Returns:
```ts
{
  dispute: Dispute,
  booking: { bookingRef, checkInAt, checkOutAt, totalAmountPaise, ... } // §5.3 Section C
  guest: { phone, totalBookings, pastDisputeCount, hasReview },
  property: { name, city, pastDisputeCount },
}
```

### 3.5 `POST /admin/disputes/:id/request-response`

Role: `ADMIN`/`SUPER_ADMIN`. Precondition: `status IN (filed, under_review)`,
else `409 Conflict`. Sets `status = awaiting_hotel_response`,
`hotelResponseDeadline = now + 48h`. Creates `dispute_response_requested`
notification for the property's `OWNER`.

### 3.6 `POST /disputes/:id/hotel-response`

Role: `PropertyRole.OWNER`/`MANAGER` on `dispute.propertyId` (existing
`PropertyRoleGuard`, M3 precedent). Precondition: `status =
awaiting_hotel_response` and `now <= hotelResponseDeadline`, else `409
Conflict` ("The response window for this dispute has closed.").

Body: `{ response: string, evidence?: string[] }`

Sets `hotelResponse`, `hotelEvidence`, `status = under_review` (back to
admin's queue).

### 3.7 `PATCH /admin/disputes/:id/resolve`

Role: `ADMIN`/`SUPER_ADMIN`. Precondition (optimistic guard, M5/M5B
`updateIfStatus` pattern): `status NOT IN (resolved_guest, resolved_hotel,
resolved_partial, resolved_wallet_credit, escalated, closed_no_response)`,
else `409 Conflict`, "This dispute has already been resolved."

Body: `{ resolutionType: DisputeResolutionType, refundAmountPaise?: number, walletCreditAmountPaise?: number, adminNotes: string }`
(`adminNotes` mandatory per spec §5.4 "all resolution actions require
mandatory admin notes").

| `resolutionType` | New `status` | Effect |
|---|---|---|
| `full_refund` | `resolved_guest` | `refundAmountPaise = booking.totalAmountPaise`; reuses M5's `POST /admin/bookings/:id/refund` bookkeeping (sets `Booking.paymentStatus = refunded`, no live gateway call, same as M5). Notifies owner: payout reduced. |
| `partial_refund` | `resolved_partial` | `refundAmountPaise` from body, validated `0 < refundAmountPaise <= booking.totalAmountPaise`. Same refund bookkeeping as above, proportional. |
| `no_action` (hotel favour) | `resolved_hotel` | No financial change. |
| `wallet_credit` | `resolved_wallet_credit` | Creates `WalletCredit` row for `guestId` with `walletCreditAmountPaise`, `sourceType = dispute`, `sourceId = dispute.id`. No payout impact (spec: "platform absorbs the cost"). |
| `escalated` | `escalated` | Terminal; internal notification only (`dispute_resolved` to property owner is **not** sent — spec says "internal notification only"). |

All branches set `resolvedBy = req.user.id`, `resolvedAt = now`,
`adminNotes`.

### 3.8 New domain event: `dispute.filed`

Emitted by `POST /bookings/:id/disputes` (M2-style event-listener pattern,
for future modules — e.g. M11 Compliance/Audit — to subscribe without
coupling). No listener is registered in M6 itself.

## 4. Auto-close scheduler — `DisputeLifecycleScheduler`

New `@Cron(CronExpression.EVERY_5_MINUTES)` job (M3 `BookingLifecycleScheduler`
pattern): sweeps `Dispute` rows where
`status IN (filed, under_review, awaiting_hotel_response)` AND
`now > resolutionDeadline`. For each:
- `status = closed_no_response`
- `resolutionType = full_refund`
- `refundAmountPaise = booking.totalAmountPaise`
- `resolvedAt = now`, `resolvedBy = null` (system-resolved)
- Applies the same refund bookkeeping as §3.7's `full_refund` branch
- Sends `dispute_resolved` notification to owner

This matches spec §5.1's "Closed — No Response: System (auto after 7 days):
Hotel did not respond within 7 days. Auto-resolved in guest favour."

## 5. ANO-011 — new anomaly rule (extends M5B `AnomalyDetectionScheduler`)

Per spec §5.4: "If hotel accumulates > 5 guest-favour dispute resolutions in
30 days, automatic alert triggers in Anomalies tab." Added as one more rule
in M5B's existing rule-engine sweep (`bookings` schema, `Anomaly` table,
`AnomalyEntityType.property`):

- **ANO-011**: `COUNT(disputes WHERE propertyId = X AND status IN
  (resolved_guest, resolved_partial, resolved_wallet_credit,
  closed_no_response) AND resolvedAt >= now() - 30 days) > 5` → creates
  `Anomaly{ ruleId: 'ANO-011', severity: 'high', entityType: 'property',
  entityId: propertyId, evidence: { disputeCount, windowDays: 30,
  sampleDisputeIds } }` if not already an unresolved ANO-011 for that
  property (same dedup precedent as ANO-001/ANO-002).

## 6. Frontend (`quicknestportal`)

### 6.1 Admin — Disputes tab (`AdminDisputesView.tsx`)

4th tab alongside All Bookings / Active Now / Anomalies (`src/routes/admin/bookings.tsx`),
tab badge shows `unresolved-count` (M5B precedent). List view per spec §5.2:
table columns `disputeRef, bookingRef, guest, property, category, filedAt,
deadline (countdown, red < 24h), status`; default sort by
`resolutionDeadline asc`. Filters: status (multi-select), category
(multi-select), date range, property.

Detail drawer (`data-testid="dispute-detail-drawer"`, M5B convention) — 3
sections per spec §5.3:
- **Section A — Guest's Complaint**: category, description, evidence gallery
  (list of URLs, rendered as links — no image preview, since no upload
  pipeline exists), requested resolution, guest's booking/dispute history.
- **Section B — Hotel's Response**: response text + evidence if present,
  else "Hotel has not responded yet. Response requested on [date]." +
  "Request Hotel Response" button (disabled once `status ===
  awaiting_hotel_response` or later); property's dispute history.
- **Section C — Booking & Payment Context**: booking summary (reuses M5's
  booking-detail data shape), "View booking" cross-link (M5B precedent).

Resolve dialog: 5 actions (Full refund / Partial refund / No action /
Wallet credit / Escalate), mandatory notes textarea, amount input shown
conditionally for partial refund and wallet credit (M5B's
`AnomalyResolveDialog` conditional-field pattern).

### 6.2 Owner — Disputes section (new Owner-portal surface)

New page under the Owner shell (e.g. `src/routes/owner/disputes.tsx` →
`OwnerDisputesView.tsx`): list of disputes where `propertyId IN
(properties the user has PropertyRole OWNER/MANAGER on)`, columns
`disputeRef, bookingRef, category, filedAt, status`. Rows with `status ===
awaiting_hotel_response` show a "Respond" action opening a form (`response`
textarea + optional evidence URL inputs) calling `POST
/disputes/:id/hotel-response`. Read-only for all other statuses (shows
`hotelResponse` if previously submitted, and `resolutionType`/outcome once
resolved).

## 7. Edge cases

| Scenario | Behaviour |
|---|---|
| Guest files a second dispute for the same booking | `409 Conflict`, "A dispute has already been filed for this booking." |
| Guest files a dispute > 48h after `checkedOutAt` | `403 Forbidden`, "The 48-hour window to file a dispute for this booking has closed." |
| Guest files a dispute on a non-`completed` booking | `409 Conflict`, "Disputes can only be filed for completed bookings." |
| Admin calls `request-response` on a dispute already `awaiting_hotel_response` or later | `409 Conflict`, "A response has already been requested for this dispute." |
| Owner submits `hotel-response` after `hotelResponseDeadline` has passed (but before the cron sweep runs) | `409 Conflict`, "The response window for this dispute has closed." — race is harmless since the cron will close it shortly after regardless |
| Owner without `PropertyRole` on `dispute.propertyId` calls `hotel-response` | `403 Forbidden` (existing `PropertyRoleGuard`) |
| `resolve` called with `resolutionType: partial_refund` and `refundAmountPaise > booking.totalAmountPaise` | `400 Bad Request`, "Refund amount cannot exceed ₹X (booking total)." |
| `resolve` called with `resolutionType: wallet_credit` and no `walletCreditAmountPaise` | `400 Bad Request` (DTO validation). |
| Two admins `PATCH .../resolve` the same dispute simultaneously | Optimistic guard — second request gets `409 Conflict`, "This dispute has already been resolved." (M5/M5B `updateIfStatus` pattern) |
| Admin opens detail for a dispute that doesn't exist | `404 Not Found`. |
| `status`/`category` filter values that don't match the enum | `400 Bad Request` (DTO validation, M5/M5B precedent). |
| `dateFrom > dateTo` | `400 Bad Request`, "dateFrom cannot be after dateTo." |

## 8. Out-of-scope confirmation (for future planning)

- **Guest-facing filing UI**: `payperhour-next` integration for
  `POST /bookings/:id/disputes` — backend contract is locked, UI deferred.
- **Evidence upload/storage**: `guestEvidence`/`hotelEvidence` are
  `string[]` of URLs with no upload pipeline — needs an S3/media-storage
  module (same gap as M5B's "listing photos" comparison).
- **Wallet redemption**: `wallet_credits` is write-only; spend/redeem at
  checkout is a future Payments/Checkout module concern (M12).
- **Real email/SMS for "Request Hotel Response"**: in-app notification only
  (M2 `owner_notifications`), matching the platform-wide notification gap.
- **Guest-facing notification inbox**: outcome notifications for the guest
  are not modeled — needs a customer-facing notifications module.
- **Ops queue / dispute reassignment**: `escalated` is terminal with internal
  notification only — a real ops-ticketing system is the same deferred item
  noted in M2 and M5B.
- **Per-category SLA tuning**: 7-day overall / 48h hotel-response are fixed
  constants in M6.
- **ANO-005/ANO-008**: unchanged M5B deferrals (price anomaly, device
  fingerprinting).

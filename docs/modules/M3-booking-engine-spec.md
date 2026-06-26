# M3: Core Booking Engine (Guest Booking & Stay Lifecycle) — Gate 0 Spec Lock

Status: LOCKED for Gate 1 implementation
Source: `Booking_Operations_Module_Spec.docx` (PayPerHour, March 2026) §1, §2.4 (Status
Timeline / Payment Details / sections 3-6), §2.5.2 (Void/Cancel/Refund decision
guide), §6 (API), §7.3 (bookings table additions), §8 (edge cases — guest-facing
subset); `docs/modules/M1-hotel-onboarding-spec.md` (`Property`, `RoomType`,
`bookingPolicy`, `minBookingHours`); `docs/modules/M2-notifications-and-admin-moderation-spec.md`
(notifications schema, event-driven pattern)

## 1. Scope boundary

`Booking_Operations_Module_Spec.docx` describes the **admin** Booking
Operations dashboard (All Bookings / Active Now / Anomalies / Disputes tabs).
That dashboard reads and acts on bookings that don't exist yet — there is no
`bookings` schema, no guest booking flow, no `Booking` model. M3 builds the
**foundation** those admin screens (and Disputes/Anomalies/Reconciliation,
later modules) will sit on top of: the guest-facing booking lifecycle from
"select a room and time" through "checked out / cancelled / no-show".

| In scope (M3) | Out of scope (later modules) |
|---|---|
| `bookings` schema: `Booking` model, `BookingStatus`/`PaymentStatus`/`BookingType` enums | Admin Booking Operations dashboard — All Bookings / Active Now / Anomalies / Disputes tabs (**M5**, tentative) |
| `GET /properties/:id/availability` — slot/room availability check | Real-time WebSocket "Active Now" feed (**M5**) |
| `POST /bookings` — create booking (price calc: base + 18% GST + platform fee), overlap/overbooking prevention | Anomaly detection engine (ANO-001..010) (**M5+**) |
| Mock payment confirmation (`POST /bookings/:id/payment/confirm`) — records `paymentStatus`/`paymentRef`; **no live Razorpay/UPI integration** | Live payment gateway integration (Razorpay), webhook signature verification (separate payments module) |
| QR code generation on confirmation; `POST /bookings/:id/check-in` (QR validation) | Disputes (post-checkout complaints, 48-hr window) (**M5+**) |
| `POST /bookings/:id/check-out` (manual) + scheduled job for auto-checkout at `checkOutAt` | Guest reviews / ratings (separate module, references `Booking.id`) |
| `POST /bookings/:id/cancel` — cancellation-policy refund **calculation** (no gateway execution) | Refund **execution** via payment gateway, payout adjustment ledger (finance module) |
| No-show detection (scheduled job: `confirmed` + `checkInAt` + grace period elapsed → `no_show`) | Extend-stay flow (admin "Extend Booking" action) |
| `GET /me/bookings`, `GET /bookings/:id` (guest) | Elasticsearch indexing / search (**M4**) |
| `GET /owner/properties/:id/bookings` (owner view, read-only) | Owner-side booking management actions (accept/reject) — bookings are auto-confirmed on payment per BRD |
| Domain events: `booking.created`, `booking.confirmed`, `booking.checked_in`, `booking.completed`, `booking.cancelled`, `booking.no_show` | `notification.requested` consumption — reuses M2's `NotificationDeliveryService` unchanged |
| `NotificationType` additive enum value `booking_update` (notifications schema) | New notification channels/templates beyond existing email/SMS gateway config |

M3 emits the events above; the M2 `NotificationDeliveryService` (already
built, config-driven) subscribes to them to populate the owner's inbox — no
changes needed to that service beyond the additive `booking_update`
`NotificationType` value and listener wiring (mirrors
`property-status.listener.ts` from M2B).

## 2. Data model

### 2.1 `bookings` schema (new)

**`Booking`** (table `bookings`):

| Column | Type | Notes |
|---|---|---|
| `id` | uuid PK | |
| `bookingRef` | `String @unique` | `PPH-B-XXXXX`, assigned on create |
| `propertyId` | uuid | cross-schema ref to `properties.Property.id`, no FK |
| `roomTypeId` | uuid | cross-schema ref to `properties.RoomType.id`, no FK |
| `guestId` | uuid | cross-schema ref to `auth.User.id`, no FK |
| `bookingType` | `BookingType` enum | `hourly \| fullday` — must be compatible with `Property.bookingPolicy` |
| `checkInAt` | `DateTime` | requested check-in instant |
| `checkOutAt` | `DateTime` | requested check-out instant (`checkInAt + durationHours` for hourly; end of day per `defaultCheckoutTime` for full-day) |
| `durationHours` | `Int` | hourly: `>= Property.minBookingHours`; full-day: 24 |
| `guestCount` | `Int` | validated `<= RoomType.maxOccupancy` (if set) |
| `baseAmountPaise` | `Int` | `RoomType.hourlyRatePaise * durationHours` or `fulldayRatePaise` |
| `gstAmountPaise` | `Int` | `round(baseAmountPaise * 0.18)` |
| `platformFeePaise` | `Int` | flat config-driven fee (env-configurable, default `0` for MVP — see §4) |
| `totalAmountPaise` | `Int` | `base + gst + platformFee` |
| `status` | `BookingStatus` enum, default `pending_payment` | |
| `paymentStatus` | `PaymentStatus` enum, default `pending` | |
| `paymentRef` | `String?` | mock gateway transaction id, set on `payment/confirm` |
| `qrCode` | `String?` | opaque token, generated on `confirmed`, consumed on check-in |
| `checkedInAt` | `DateTime?` | actual check-in timestamp |
| `checkedOutAt` | `DateTime?` | actual checkout timestamp (manual or auto job) |
| `cancelledAt` | `DateTime?` | |
| `cancelledBy` | `String?` | `guest \| system` (admin-initiated cancellation deferred to M5) |
| `cancelReason` | `String?` | |
| `refundAmountPaise` | `Int?` | calculated per cancellation policy, execution deferred |
| `noShowAt` | `DateTime?` | set by scheduled job |
| `createdAt` / `updatedAt` | `DateTime` | |

`@@index([propertyId, checkInAt, checkOutAt])` (availability/overlap queries),
`@@index([guestId])`, `@@index([status])`, `@@map("bookings")`,
`@@schema("bookings")`.

**`BookingType`** enum — `hourly | fullday`, `@@schema("bookings")`.

**`BookingStatus`** enum — `pending_payment | confirmed | checked_in |
completed | cancelled | no_show`, `@@schema("bookings")`.
(`refunded` from the admin spec is **not** a separate status in M3 — a
cancelled booking with `refundAmountPaise > 0` represents the refunded case;
the admin spec's `refunded` status applies to post-completion refunds, which
are out of scope per §1.)

**`PaymentStatus`** enum — `pending | success | failed`, `@@schema("bookings")`.

### 2.2 `notifications` schema (additive)

**`NotificationType`** — add `booking_update` to the existing enum
(`status_change | revision_request | approval | rejection | document_verified
| general | booking_update`). Used for: booking confirmed, check-in reminder
(deferred — no cron for reminders in M3), cancellation, no-show.

## 3. Availability & overlap prevention

`GET /properties/:id/availability?roomTypeId=&date=&type=hourly|fullday`

- Returns booked intervals for the given `roomTypeId`/date so the frontend
  can disable conflicting slots.
- **Overbooking prevention** (mirrors ANO-003 from the admin spec, but
  enforced preventatively rather than detected after the fact): `POST
  /bookings` runs inside a DB transaction with a `SELECT ... FOR UPDATE` (or
  Postgres exclusion constraint via `tstzrange` + `&&` operator) on
  `(roomTypeId, [checkInAt, checkOutAt))` for rows with `status IN
  (pending_payment, confirmed, checked_in)`. A second concurrent request for
  an overlapping slot gets `409 Conflict`.
- `RoomType.count` (number of rooms of that type) means up to `count`
  concurrent bookings per overlapping interval are allowed — the overlap
  check counts existing non-terminal bookings for the slot and rejects only
  when `count` would be exceeded.

## 4. Pricing

- `baseAmountPaise`:
  - `hourly`: `RoomType.hourlyRatePaise * durationHours` (`durationHours >=
    Property.minBookingHours`, default 3 if unset per M1 §2.1)
  - `fullday`: `RoomType.fulldayRatePaise`
  - `400` if the requested `bookingType` isn't allowed by
    `Property.bookingPolicy` (e.g. `hourly` request on a `fullday`-only
    property), or if the relevant rate is `null` on `RoomType`.
- `gstAmountPaise = round(baseAmountPaise * 0.18)` (matches admin spec §2.4
  Section 6 example: ₹800 base → ₹144 GST).
- `platformFeePaise`: flat value from `BOOKING_PLATFORM_FEE_PAISE` env var,
  default `0` for MVP (commission/fee structure is a finance-module concern;
  M3 just plumbs the field through so the total matches the admin spec's
  `Total Charged` breakdown).
- `totalAmountPaise = baseAmountPaise + gstAmountPaise + platformFeePaise`.

## 5. Booking lifecycle & state machine

```
pending_payment --(payment/confirm: success)--> confirmed
pending_payment --(payment/confirm: failed)----> [terminal: row kept, paymentStatus=failed,
                                                    status stays pending_payment;
                                                    guest may retry POST /bookings/:id/payment/confirm]
confirmed --(check-in: QR valid, now >= checkInAt - 15min)--> checked_in
confirmed --(cancel, before checkInAt)--------> cancelled (refund per policy)
confirmed --(no-show job: now > checkInAt + grace)--> no_show
checked_in --(check-out: manual or auto job at checkOutAt)--> completed
```

- **Grace period** for no-show: 30 minutes past `checkInAt` (matches admin
  spec §2.4 example "No-Show detected ... 30-min grace period").
- **Auto-checkout job**: scheduled job (reuses the existing cron
  infrastructure pattern from `redis`/notification modules) runs every 5
  minutes; any `checked_in` booking with `now >= checkOutAt` →
  `checkedOutAt = checkOutAt`, `status = completed`.
- **No-show job**: same cadence; any `confirmed` booking with `now >
  checkInAt + 30min` and no `checkedInAt` → `status = no_show`,
  `noShowAt = now`.

## 6. Cancellation policy (refund calculation only)

Mirrors the admin spec's "refund per cancellation policy (auto-calculated)"
(§2.5, Cancel Booking row). MVP policy, applied in `POST /bookings/:id/cancel`:

| Time of cancellation relative to `checkInAt` | Refund |
|---|---|
| `hourly` booking, `>= 2 hours` before | 100% (`refundAmountPaise = totalAmountPaise`) |
| `hourly` booking, `< 2 hours` before or after `checkInAt` | 0% |
| `fullday` booking, `>= 24 hours` before | 100% |
| `fullday` booking, `< 24 hours` before or after `checkInAt` | 50% (`refundAmountPaise = totalAmountPaise / 2`) |

- Only `confirmed` bookings can be cancelled (`pending_payment` bookings can
  simply be abandoned — no row mutation needed; `checked_in`/`completed`
  cancellation is the admin-initiated refund flow, out of scope per §1).
- `refundAmountPaise` is **recorded**, not paid out — execution is a finance/
  payments-module concern. Response includes the calculated amount so the
  frontend can show "Refund of ₹X will be processed within N business days"
  per BRD post-submission UX patterns established in M1.

## 7. API specification

| Method | Endpoint | Auth | Purpose |
|---|---|---|---|
| `GET` | `/properties/:id/availability` | public | Booked intervals per room type/date |
| `POST` | `/bookings` | guest | Create booking (`pending_payment`); body: `roomTypeId, bookingType, checkInAt, durationHours?, guestCount` |
| `POST` | `/bookings/:id/payment/confirm` | guest | Mock payment webhook; body: `{ success: boolean, paymentRef? }`. On success → `confirmed` + generates `qrCode` + emits `booking.confirmed` |
| `GET` | `/bookings/:id` | guest (own) | Full detail incl. timeline derived from timestamps |
| `GET` | `/me/bookings` | guest | List own bookings, filter by `status` |
| `POST` | `/bookings/:id/check-in` | guest or owner-staff | body: `{ qrCode }`. Validates token + timing window |
| `POST` | `/bookings/:id/check-out` | guest or owner-staff | Manual checkout before `checkOutAt` |
| `POST` | `/bookings/:id/cancel` | guest (own) | body: `{ reason? }`. Calculates refund, sets `cancelled` |
| `GET` | `/owner/properties/:id/bookings` | owner (property role) | Read-only list for the owner's property |

All write endpoints emit the corresponding `booking.*` domain event after
commit, consumed by the M2 `NotificationDeliveryService`.

## 8. Edge cases & error handling (guest-facing subset)

Selected from `Booking_Operations_Module_Spec.docx` §8, scoped to what M3
controls (admin-action edge cases — void/refund-gateway-down/dispute-window —
are deferred with the admin dashboard):

| Scenario | Expected behaviour |
|---|---|
| Two guests submit overlapping bookings for the same room type/slot simultaneously | Second request gets `409 Conflict` via the transactional overlap check (§3); frontend re-fetches availability and shows "This slot was just booked — please choose another time." |
| `POST /bookings` with `bookingType` not allowed by `Property.bookingPolicy` | `400` — "This property only accepts {policy} bookings." |
| `guestCount > RoomType.maxOccupancy` | `400` — "Maximum occupancy for this room is N guests." |
| `durationHours < Property.minBookingHours` (hourly) | `400` — "Minimum booking duration is N hours." |
| `payment/confirm` called with `success: false` | `paymentStatus = failed`, `status` stays `pending_payment`; guest may retry. After 3 failed attempts, booking auto-expires (scheduled job marks `pending_payment` rows older than 30 min with no successful payment as `cancelled`, `cancelReason = "payment_timeout"`) |
| `check-in` attempted with stale/already-consumed `qrCode` | `409` — "This QR code has already been used." |
| `check-in` attempted before `checkInAt - 15min` or after `checkInAt + 30min` (no-show grace expired) | `409` — "Check-in window has closed for this booking." |
| `cancel` called on a `checked_in`/`completed`/`cancelled`/`no_show` booking | `409` — "This booking can no longer be cancelled." |
| `check-out` called before any check-in (`checked_in` never reached) | `409` — "This booking has not been checked in yet." |
| Auto-checkout job runs while a `cancel`/`check-in` request is in flight for the same booking | Row-level lock (same transaction pattern as §3) — whichever commits first wins; the loser gets `409` and re-fetches current status |

## 9. Out-of-scope confirmation (for M5+ planning)

The following from `Booking_Operations_Module_Spec.docx` are explicitly
deferred and will need their own Gate 0 spec once M3 is signed off, since
they all read/write the `Booking` model M3 introduces:

- Admin "All Bookings" / "Active Now" / KPI strip / CSV export
- Anomaly detection engine (ANO-001..010) and Anomalies tab
- Disputes tab and 48-hr post-checkout complaint flow
- Admin actions: Void, Trigger Refund (execution), Force Checkout, Extend
  Booking, Flag for Review
- Reviews (Section 9 of booking detail — "Guest Review")

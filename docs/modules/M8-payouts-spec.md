# M8 — Payouts & Settlements

## 1. Overview

Weekly settlement of owner earnings for all `completed` bookings in the prior cycle.  
Platform deducts its fee and withholds TDS (Section 194O, 1%) before releasing net payout.

---

## 2. Financial Rules

```
ownerGrossPaise  = baseAmountPaise - platformFeePaise
tdsPaise         = round(ownerGrossPaise * 0.01)   // 1% TDS (Section 194O)
ownerNetPaise    = ownerGrossPaise - tdsPaise
```

- GST (`gstAmountPaise`) flows to government — not part of owner settlement.
- Refunded bookings: only the **un-refunded portion** contributes.
  - `ownerGrossPaise` on a partially refunded booking = max(0, baseAmountPaise - platformFeePaise - refundAmountPaise)
  - Fully refunded bookings are excluded entirely.
- A booking qualifies when: `status = 'completed'` AND `checkOutAt` falls within the cycle window AND not already included in a prior payout item.

---

## 3. Payout Cycle

- **Cycle:** Monday 00:00 → Sunday 23:59 (IST).
- **Generation:** Scheduled every Monday at 02:00 IST — creates one `PayoutBatch` for the prior week.
- **Release:** Admin manually reviews the batch and clicks "Release selected" or "Release all". Items on hold are skipped.
- **Hold:** Admin can hold any individual `PayoutItem` (e.g., compliance issue, pending dispute). Hold reason is required.

---

## 4. Schema (`payouts` schema)

### `PayoutBatch`

| Column | Type | Notes |
|--------|------|-------|
| id | UUID PK | |
| batchRef | String UNIQUE | `PAY-YYYYMMDD` (cycle end date) |
| cycleStartAt | DateTime | Monday 00:00 UTC |
| cycleEndAt | DateTime | Sunday 23:59:59 UTC |
| status | PayoutBatchStatus | pending \| processing \| released \| partial \| failed |
| totalGrossPaise | Int | sum of item grossAmountPaise |
| totalTdsPaise | Int | sum of item tdsPaise |
| totalNetPaise | Int | sum of item netAmountPaise |
| itemCount | Int | number of PayoutItems in batch |
| createdAt | DateTime | |
| updatedAt | DateTime | |

### `PayoutItem`

| Column | Type | Notes |
|--------|------|-------|
| id | UUID PK | |
| batchId | UUID FK → PayoutBatch | |
| propertyId | UUID | plain UUID (cross-schema) |
| ownerId | UUID | plain UUID (cross-schema) |
| status | PayoutItemStatus | pending \| on_hold \| released \| failed |
| bookingCount | Int | number of bookings included |
| grossAmountPaise | Int | sum of ownerGross across bookings |
| tdsPaise | Int | 1% of gross |
| netAmountPaise | Int | gross - tds |
| holdReason | String? | required when status=on_hold |
| bankRef | String? | bank transfer reference after release |
| releasedAt | DateTime? | |
| createdAt | DateTime | |
| updatedAt | DateTime | |

**Indexes:** `(batchId)`, `(ownerId)`, `(propertyId)`, `(status)`  
**Unique:** `(batchId, propertyId)` — one item per property per batch

### `PayoutBookingLink`

| Column | Type | Notes |
|--------|------|-------|
| id | UUID PK | |
| payoutItemId | UUID FK → PayoutItem | |
| bookingId | UUID | plain UUID (cross-schema) |
| ownerGrossPaise | Int | at time of payout generation |
| tdsPaise | Int | 1% of ownerGross |

**Unique:** `(bookingId)` — a booking is included in at most one payout item ever

### Enums

```
PayoutBatchStatus: pending | processing | released | partial | failed
PayoutItemStatus:  pending | on_hold | released | failed
```

---

## 5. API Contract

### Owner (JWT required, role=owner)

| Method | Path | Description |
|--------|------|-------------|
| GET | `/owner/payouts` | List payout batches for their property (paginated) |
| GET | `/owner/payouts/:batchId` | Batch detail + booking breakdown |

**GET /owner/payouts** response:
```json
{
  "items": [PayoutSummary],
  "total": 12,
  "page": 1,
  "limit": 20
}
```

`PayoutSummary`: `{ id, batchRef, cycleStartAt, cycleEndAt, status, grossAmountPaise, tdsPaise, netAmountPaise, bookingCount, releasedAt }`

**GET /owner/payouts/:batchId** response: `PayoutDetail` with additional `bookings: PayoutBookingRow[]`

`PayoutBookingRow`: `{ bookingId, bookingRef, checkOutAt, ownerGrossPaise, tdsPaise }`

### Admin (roles: ADMIN, SUPER_ADMIN)

| Method | Path | Description |
|--------|------|-------------|
| GET | `/admin/payouts` | List all batches (paginated, filterable by status) |
| GET | `/admin/payouts/:batchId` | Batch detail with all items |
| POST | `/admin/payouts/generate` | Manually trigger batch generation for a date range |
| POST | `/admin/payouts/:batchId/release` | Release all `pending` items in batch |
| POST | `/admin/payouts/items/:itemId/hold` | Put item on hold |
| POST | `/admin/payouts/items/:itemId/release` | Release a single held item |
| GET | `/admin/payouts/summary` | KPI strip: total released MTD, total pending, on-hold count |

**POST /admin/payouts/generate** body: `{ cycleStartAt: ISO, cycleEndAt: ISO }`  
Returns: `{ batchId, batchRef, itemCount, totalNetPaise }`

**POST /admin/payouts/items/:itemId/hold** body: `{ reason: string (max 500) }`

---

## 6. Scheduler

One cron job: `PayoutsLifecycleScheduler.handleWeeklyBatch()`  
Schedule: `0 2 * * 1` (02:00 every Monday)  
Logic: calculates prior week's cycle window → calls `payoutsService.generateBatch(cycleStart, cycleEnd)`

---

## 7. Modular-Monolith Rules

- `PayoutItem.propertyId` and `PayoutItem.ownerId` are plain UUIDs — no Prisma FK to other schemas.
- `PayoutBookingLink.bookingId` is a plain UUID — no FK to `bookings.bookings`.
- Read booking data for generation via `BookingsRepository` (already exported) or raw SQL in `PayoutsRepository`.
- Emit domain event `PAYOUT_RELEASED` after batch release for notification module.

---

## 8. Domain Events

```typescript
PAYOUT_RELEASED: 'payout.released'
// Payload: { payoutItemId, ownerId, propertyId, netAmountPaise, batchRef }
```

Notifications module listens and sends `payout_released` notification to owner.

---

## 9. Frontend Screens

### Owner Portal — `/owner/payouts`

- **KPI strip (3 cards):** Upcoming (pending), Released (last 30d total net), TDS withheld (YTD)
- **Payout history table:** columns = Settlement ref, Cycle, Bookings, Gross, TDS, Net, Status, Detail link
- **Detail drawer:** booking-level breakdown table, download TDS certificate button (stub)
- Uses `SectionCard` + light `navy-*` / `border` tokens — NO dark theme

### Admin Portal — `/admin/payouts`

- **KPI strip (4 cards):** Pending batches, Items on hold, Released MTD, TDS withheld MTD
- **Batch list table:** columns = Batch ref, Cycle, Items, Total net, Status, Actions
- **Batch detail drawer:** per-item table with Hold / Release buttons
- Hold dialog: requires reason text (min 10 chars)
- Release batch button: confirmation "Release N items?"
- Uses `admin-*` Tailwind tokens (dark theme) — Admin portal only

---

## 10. Notification Type

Add `payout_released` to the `NotificationType` enum in the notifications schema.

---

## 11. Test Strategy

**Unit tests (Jest, quicknestserver):**
- `generateBatch`: correct amount calculations, excludes refunded bookings, deduplicates (ON CONFLICT DO NOTHING on bookingId)
- `releaseItem`: status transitions, bankRef set
- `holdItem`: requires reason, sets on_hold
- Amount math: ownerGross, TDS rounding

**E2E (Playwright, quicknestportal):**
- Owner: list shows payout history, detail drawer shows breakdown
- Admin: batch list, hold flow, release flow
- Admin sidebar badge count (on-hold items)

---

## 12. Out of Scope

- Actual bank transfer integration (stub with bankRef = `MOCK-{timestamp}`)
- TDS certificate PDF generation (button stub only)
- GST invoice generation

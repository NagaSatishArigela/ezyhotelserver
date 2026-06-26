# M7 — Reviews & Ratings
**Post-Checkout Trust & Reputation Engine**

Status: **LOCKED** · Source: `PayPerHour_Module8_Reviews_Ratings_Spec.docx` (adapted to NestJS/Prisma stack)

---

## 0. Open Decisions — Resolved for MVP

| ID | Decision | Resolution |
|----|----------|------------|
| OD-8-01 | Anonymous reviews | **Option A** — No anonymity; full name always shown |
| OD-8-02 | Photo moderation | **Option A** — Auto-publish photos (accept `photoUrls[]` string array; no S3 presign in MVP) |
| OD-8-03 | Admin platform response | **Option A** — Only owner can reply |
| OD-8-04 | Minimum display threshold | **Option B** — 5 verified published reviews before rating shown on listings |
| OD-8-05 | Owner flagging | **Option A** — Owner can flag once per review |
| OD-8-06 | Review backfill | **Option A** — No backfill; reviews start from M7 launch |
| OD-8-07 | Score weighting | **Option A** — Weighted: Cleanliness 25%, Accuracy 20%, Amenities 20%, Value 20%, Check-in 15% |
| OD-8-08 | Review window | **Option B** — 72 hours (opens 2 h after checkout, closes 74 h after checkout) |

**Stack delta from original spec:** No S3 presign (plain URL strings), no Elasticsearch sync, no Redis submission mutex (DB UNIQUE constraint sufficient). Redis retained for owner-flag rate limiting. Cron via `@nestjs/schedule` matching existing `DisputeLifecycleScheduler` pattern.

---

## 1. Module Overview

| Attribute | Value |
|-----------|-------|
| Module name | Reviews & Ratings |
| Prisma schema | `reviews` (already declared in `datasource.schemas`) |
| Depends on | M3 (Booking, `completed` status), M2 (Notifications), M1 (Property) |
| Unlocks | N/A within current roadmap |
| Primary actors | Guest (reviewer), Owner (responder), Admin (moderator) |
| Trigger event | `booking.status` transitions to `completed` |
| Review window | Opens at `checkout_at + 2 h`; closes at `checkout_at + 74 h` |
| Rating denominator | 5.0, displayed to 1 decimal |
| Minimum display | 5 published reviews before `rating_avg` shown on property |
| Photos | Up to 5 URL strings per review |
| Moderation | Auto-flag on PII/profanity regex; admin moderation queue |
| Owner reply window | 96 h from `published_at` |

---

## 2. Business Rules

### 2.1 Eligibility & Timing

| Rule | Value |
|------|-------|
| Eligibility gate | `booking.status = completed` only (cancelled, no_show, voided → no window) |
| Window opens | `checkout_at + 2 h` (delay prevents hasty reviews) |
| Window closes | `checkout_at + 74 h` (2 h delay + 72 h window) |
| One review per booking | Enforced via `UNIQUE(booking_id)` |
| Amendments post-submit | Not allowed |
| Owner reply window | 96 h from `review.published_at` |
| Admin deletion | Any time; mandatory reason; triggers rating recalculation |

### 2.2 Rating Dimensions & Weighted Score

Five sub-scores (1–5 integer stars each):

| Field | Label | Weight |
|-------|-------|--------|
| `score_cleanliness` | Cleanliness | 25% |
| `score_amenities` | Amenities & Facilities | 20% |
| `score_accuracy` | Accuracy of Listing | 20% |
| `score_value` | Value for Money | 20% |
| `score_checkin` | Check-in Experience | 15% |
| `score_overall` | Overall Experience | Excluded from weighted avg — shown separately |

**Display score formula:**
```
display_score = (score_cleanliness * 0.25)
              + (score_amenities   * 0.20)
              + (score_accuracy    * 0.20)
              + (score_value       * 0.20)
              + (score_checkin     * 0.15)
```

`display_score` is stored as a `DECIMAL(3,2)` column, computed in the service layer on every submit.

### 2.3 Moderation Rules

| Trigger | Action | Status |
|---------|--------|--------|
| PII detected (phone / email / Aadhaar regex) on submit | Auto-flag | `flagged` |
| Profanity list match on submit | Auto-flag | `flagged` |
| Guest reports a published review | Flag event created | `flagged` |
| Owner flags a review (once; rate-limit: 3/week per owner) | Flag event created | `flagged` |
| Admin approves flagged review | Manual action | `published` |
| Admin removes review (mandatory reason) | Manual action | `removed` |
| Clean submission | Auto-publish | `published` |

### 2.4 State Machine

```
(none)   ──[booking completed + cron]──►  pending
pending  ──[guest submits, no flags]──►   published
pending  ──[guest submits, flags hit]──►  flagged
pending  ──[expires_at passed, cron]──►   removed
flagged  ──[admin approves]──►            published
flagged  ──[admin removes (reason)]──►   removed
published ──[admin removes (reason)]──►  removed
published ──[guest/owner flags]──►       flagged   (hidden from public)
```

### 2.5 Edge Cases

| Scenario | Handling |
|----------|----------|
| Submit after `expires_at` | 410 Gone — `REVIEW_WINDOW_EXPIRED` |
| Submit before `window_opens_at` | 403 Forbidden — `REVIEW_WINDOW_NOT_OPEN` |
| Second submission same booking | 409 Conflict — `REVIEW_ALREADY_EXISTS` |
| Review text 1–9 chars | 400 Validation — min 10 chars if text provided |
| Photo-only review (text null) | Allowed — `review_text` is nullable |
| Booking not `completed` | 403 Forbidden — `BOOKING_NOT_ELIGIBLE` |
| Owner replies after 96 h | 403 Forbidden — `REPLY_WINDOW_EXPIRED` |
| Owner second reply | 409 Conflict — `REPLY_ALREADY_EXISTS` |
| Booking extended mid-stay | Window opens on new `checkout_at` |

---

## 3. Prisma Schema

### 3.1 New Enum

```prisma
enum ReviewStatus {
  pending
  published
  flagged
  removed

  @@schema("reviews")
}
```

### 3.2 Review Table

```prisma
model Review {
  id               String       @id @default(uuid())
  bookingId        String       @unique           @map("booking_id")
  propertyId       String                         @map("property_id")
  guestId          String                         @map("guest_id")
  ownerId          String                         @map("owner_id")

  // Scores (1–5 integer)
  scoreOverall     Int                            @map("score_overall")
  scoreCleanliness Int                            @map("score_cleanliness")
  scoreAmenities   Int                            @map("score_amenities")
  scoreAccuracy    Int                            @map("score_accuracy")
  scoreValue       Int                            @map("score_value")
  scoreCheckin     Int                            @map("score_checkin")
  displayScore     Decimal      @db.Decimal(3, 2) @map("display_score")

  reviewText       String?                        @map("review_text")
  photoUrls        String[]                       @map("photo_urls")

  status           ReviewStatus @default(pending)

  // Owner reply
  ownerReply         String?    @map("owner_reply")
  ownerRepliedAt     DateTime?  @map("owner_replied_at")
  replyWindowEnd     DateTime?  @map("reply_window_end")
  replyReminderSent  Boolean    @default(false)  @map("reply_reminder_sent")

  // Lifecycle
  windowOpensAt  DateTime           @map("window_opens_at")
  expiresAt      DateTime           @map("expires_at")
  promptSentAt   DateTime?          @map("prompt_sent_at")
  submittedAt    DateTime?          @map("submitted_at")
  publishedAt    DateTime?          @map("published_at")

  createdAt  DateTime  @default(now()) @map("created_at")
  updatedAt  DateTime  @updatedAt      @map("updated_at")

  flags    ReviewFlag[]
  auditLog ReviewAuditLog[]

  @@schema("reviews")
  @@map("reviews")
}
```

### 3.3 ReviewFlag Table

```prisma
model ReviewFlag {
  id        String   @id @default(uuid())
  reviewId  String                    @map("review_id")
  flaggedBy String                    @map("flagged_by")
  flagRole  String                    @map("flag_role")   // 'guest' | 'owner' | 'system' | 'admin'
  reason    String?
  createdAt DateTime @default(now())  @map("created_at")

  @@schema("reviews")
  @@map("review_flags")
}
```

### 3.4 ReviewAuditLog Table

```prisma
model ReviewAuditLog {
  id         String        @id @default(uuid())
  reviewId   String                             @map("review_id")
  actor      String                             // userId or 'system'
  actorRole  String                             @map("actor_role")
  action     String                             // 'created' | 'submitted' | 'published' | 'flagged' | 'removed' | 'replied' | 'flag_added'
  fromStatus ReviewStatus?                      @map("from_status")
  toStatus   ReviewStatus?                      @map("to_status")
  reason     String?
  createdAt  DateTime      @default(now())      @map("created_at")

  @@schema("reviews")
  @@map("review_audit_log")
}
```

### 3.5 Property Model Extensions

Add four columns to the existing `Property` model in `schema.prisma`:

```prisma
// Inside model Property { ... }
ratingAvg        Float?   @map("rating_avg")       // null until 5 published reviews
ratingCount      Int      @default(0) @map("rating_count")
ratingBreakdown  Json?    @map("rating_breakdown")  // { "1": n, "2": n, "3": n, "4": n, "5": n }
ratingDimensions Json?    @map("rating_dimensions") // { "cleanliness": avg, "amenities": avg, ... }
```

### 3.6 Key Indexes

```sql
CREATE UNIQUE INDEX reviews_booking_id_key ON reviews.reviews(booking_id);
CREATE INDEX reviews_property_status ON reviews.reviews(property_id, status);
CREATE INDEX reviews_guest ON reviews.reviews(guest_id);
CREATE INDEX reviews_window ON reviews.reviews(status, window_opens_at) WHERE status = 'pending';
CREATE INDEX reviews_expiry ON reviews.reviews(status, expires_at) WHERE status = 'pending';
```

---

## 4. API Contracts

All endpoints require `Authorization: Bearer <JWT>` except public property endpoints.

### 4.1 Guest Endpoints

| Method | Path | Guard | Description |
|--------|------|-------|-------------|
| `POST` | `/reviews` | `JwtAuthGuard` + role=guest | Submit a review for a completed booking |
| `GET` | `/reviews/pending` | `JwtAuthGuard` + role=guest | List bookings awaiting review |
| `GET` | `/reviews/my` | `JwtAuthGuard` + role=guest | All reviews submitted by the guest |
| `POST` | `/reviews/:id/report` | `JwtAuthGuard` + role=guest | Report a published review |

**POST /reviews — Request body:**
```json
{
  "bookingId":        "uuid",
  "scoreOverall":     5,
  "scoreCleanliness": 5,
  "scoreAmenities":   4,
  "scoreAccuracy":    5,
  "scoreValue":       4,
  "scoreCheckin":     5,
  "reviewText":       "string (optional; min 10 chars if provided)",
  "photoUrls":        ["https://..."] // optional, max 5
}
```

**POST /reviews — Responses:**
- `201` — review object (status: `published` or `flagged`)
- `400` — validation error
- `403` — `BOOKING_NOT_ELIGIBLE` / `REVIEW_WINDOW_NOT_OPEN`
- `409` — `REVIEW_ALREADY_EXISTS`
- `410` — `REVIEW_WINDOW_EXPIRED`

**GET /reviews/pending — Response:**
```json
{
  "bookings": [
    {
      "bookingId":        "uuid",
      "bookingRef":       "PPH-B-00001",
      "propertyName":     "...",
      "checkOutAt":       "ISO8601",
      "windowOpensAt":    "ISO8601",
      "expiresAt":        "ISO8601",
      "expiresInSeconds": 43200
    }
  ]
}
```

### 4.2 Public Endpoints (no auth)

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/properties/:id/reviews` | Paginated published reviews for a property |
| `GET` | `/properties/:id/reviews/summary` | Aggregate score card (for search listing cards) |

**GET /properties/:id/reviews — Query params:**
- `page` (default 1), `limit` (default 10, max 50)
- `sort`: `recent` (default) | `highest` | `lowest`
- `scoreFilter`: 1–5 (filter by `score_overall`)
- `withPhotos`: boolean
- `withReply`: boolean

**GET /properties/:id/reviews/summary — Response:**
```json
{
  "ratingAvg":   4.3,
  "ratingCount": 12,
  "breakdown":   { "1": 0, "2": 1, "3": 1, "4": 5, "5": 5 },
  "dimensions":  { "cleanliness": 4.5, "amenities": 4.1, "accuracy": 4.3, "value": 4.2, "checkin": 4.4 },
  "meetsThreshold": true
}
```

### 4.3 Owner Endpoints

| Method | Path | Guard | Description |
|--------|------|-------|-------------|
| `GET` | `/owner/properties/:propertyId/reviews` | `JwtAuthGuard` + `PropertyRoleGuard(OWNER, MANAGER)` | All reviews for a property |
| `POST` | `/owner/reviews/:id/reply` | `JwtAuthGuard` | Post public reply to a review |
| `POST` | `/owner/reviews/:id/flag` | `JwtAuthGuard` | Flag a review for admin moderation |

**POST /owner/reviews/:id/reply — Request body:**
```json
{ "reply": "string (min 1, max 1000)" }
```
- `200` — updated review
- `403` — `REPLY_WINDOW_EXPIRED`
- `409` — `REPLY_ALREADY_EXISTS`

**POST /owner/reviews/:id/flag — Request body:**
```json
{ "reason": "string (optional)" }
```
- `201` — flag created
- `409` — `ALREADY_FLAGGED_BY_OWNER` (once per review per owner)
- `429` — rate limit (3 flags/week per owner, tracked in DB)

### 4.4 Admin Endpoints

| Method | Path | Guard | Description |
|--------|------|-------|-------------|
| `GET` | `/admin/reviews` | `JwtAuthGuard` + role=admin | All reviews, filterable by status/property/score |
| `GET` | `/admin/reviews/flagged` | `JwtAuthGuard` + role=admin | Moderation queue (status=flagged) |
| `POST` | `/admin/reviews/:id/moderate` | `JwtAuthGuard` + role=admin | Publish or remove a flagged review |
| `DELETE` | `/admin/reviews/:id` | `JwtAuthGuard` + role=admin | Hard-remove any review (mandatory reason) |
| `GET` | `/admin/reviews/:id/audit` | `JwtAuthGuard` + role=admin | Full audit log for a review |

**POST /admin/reviews/:id/moderate — Request body:**
```json
{
  "action": "publish" | "remove",
  "reason": "string (required when action=remove)"
}
```

**DELETE /admin/reviews/:id — Request body:**
```json
{ "reason": "string (required)" }
```

---

## 5. NestJS Module Structure

```
src/modules/reviews/
├── reviews.module.ts
├── reviews.service.ts          # Core business logic
├── reviews.repository.ts       # Raw queries for listing, aggregates
├── reviews-lifecycle.scheduler.ts  # @Cron jobs
├── reviews.controller.ts       # Guest endpoints
├── owner-reviews.controller.ts # Owner endpoints (PropertyRoleGuard)
├── admin-reviews.controller.ts # Admin endpoints
├── dto/
│   ├── submit-review.dto.ts
│   ├── reply-review.dto.ts
│   ├── flag-review.dto.ts
│   ├── moderate-review.dto.ts
│   ├── list-reviews-query.dto.ts      # shared pagination+filter DTO
│   └── list-owner-reviews-query.dto.ts
└── __tests__/
    └── reviews.service.spec.ts
```

**Module imports:** `AuthModule`, `BookingsModule` (for booking lookup), `NotificationsModule`

---

## 6. Cron Jobs (`ReviewsLifecycleScheduler`)

| Job | Schedule | Action | Idempotency |
|-----|----------|--------|-------------|
| `openReviewWindows` | Every 5 min | Find `completed` bookings with no `Review` record → INSERT pending rows with `window_opens_at`, `expires_at` | `INSERT ... ON CONFLICT (booking_id) DO NOTHING` |
| `sendReviewPrompts` | Every 5 min | Find pending reviews where `window_opens_at <= NOW()` AND `prompt_sent_at IS NULL` → emit `review.window_opened` notification + set `prompt_sent_at` | `prompt_sent_at` null check |
| `expireReviews` | Every 30 min | Find pending reviews where `expires_at < NOW()` AND `submitted_at IS NULL` → set `status = removed`, log to audit | status=pending guard |
| `sendReplyReminders` | Every 1 hour | Find published reviews where `reply_window_end BETWEEN NOW() AND NOW()+24h` AND `owner_reply IS NULL` AND `reply_reminder_sent = false` → emit `review.reply_window_reminder` + set flag | `reply_reminder_sent` boolean |

---

## 7. Rating Recalculation

Called from `ReviewsService.recalculatePropertyRating(propertyId)` after every status transition that changes the published count (submit → published, flagged → published, published → removed).

```sql
-- Recalculate from published reviews only
SELECT
  COUNT(*)                                                    AS rating_count,
  AVG(display_score)                                         AS rating_avg,
  AVG(score_cleanliness)                                     AS dim_cleanliness,
  AVG(score_amenities)                                       AS dim_amenities,
  AVG(score_accuracy)                                        AS dim_accuracy,
  AVG(score_value)                                           AS dim_value,
  AVG(score_checkin)                                         AS dim_checkin,
  COUNT(*) FILTER (WHERE score_overall = 1)                  AS star_1,
  COUNT(*) FILTER (WHERE score_overall = 2)                  AS star_2,
  COUNT(*) FILTER (WHERE score_overall = 3)                  AS star_3,
  COUNT(*) FILTER (WHERE score_overall = 4)                  AS star_4,
  COUNT(*) FILTER (WHERE score_overall = 5)                  AS star_5
FROM reviews.reviews
WHERE property_id = $1 AND status = 'published'
```

Update `properties.rating_avg`, `rating_count`, `rating_breakdown`, `rating_dimensions`. Set `rating_avg = null` if `rating_count < 5` (minimum display threshold OD-8-04).

---

## 8. PII / Profanity Auto-Flag

On every `POST /reviews` submission, before persisting:
1. Run regex against `reviewText` for phone numbers (`\+?91?\s*[6-9]\d{9}`), email (`\S+@\S+\.\S+`), Aadhaar (`\d{4}\s?\d{4}\s?\d{4}`)
2. Check against profanity word list stored in `config.profanity_words` (env-seeded array; admin-configurable via future config endpoint)
3. If any match → set `status = flagged`, create `ReviewFlag` with `flagRole = 'system'`, log audit, emit `review.flagged_admin` notification
4. Otherwise → set `status = published`, set `published_at`, trigger rating recalc, emit `review.new_on_property` to owner

---

## 9. Notification Events (→ NotificationsModule)

| Event Key | Trigger | Recipient | Channel |
|-----------|---------|-----------|---------|
| `review.window_opened` | Cron: `window_opens_at` reached | Guest | FCM + SMS |
| `review.window_expiring` | Cron: `expires_at - 12h` | Guest | FCM |
| `review.published` | Auto-publish or admin approves | Guest | FCM |
| `review.flagged_admin` | Auto or manual flag | Admin | In-app notification |
| `review.removed` | Admin removes review | Guest | FCM |
| `review.new_on_property` | Review published on property | Owner | FCM + Email |
| `review.reply_added` | Owner posts reply | Guest | FCM |
| `review.reply_window_reminder` | 24 h before reply window closes | Owner | FCM |

---

## 10. Frontend Screens

### 10.1 Owner Portal — Reviews Page (`/owner/disputes` pattern)

Path: `/owner/reviews` (currently mocked; wire to real API)

**View: `OwnerReviewsView`**
- Summary card at top: star rating display (if ≥5 reviews), breakdown histogram, dimension scores
- Table: Dispute ref, Guest name (or "Anonymous"), Score overall, Category highlights, Filed at, Status badge, "Reply" button (if `owner_reply IS NULL` AND within reply window), "Flag" button (if not already flagged)
- Reply dialog: textarea (max 1000 chars), submit → `POST /owner/reviews/:id/reply`
- Flag dialog: optional reason, submit → `POST /owner/reviews/:id/flag`

**API client:** `src/lib/api/ownerReviews.ts`

### 10.2 Admin Portal — Reviews Page

New page: `/admin/reviews` (separate from bookings, own sidebar link)

**Component: `AdminReviewsPage`** with two tabs:
1. **Flagged** (default) — moderation queue; table shows review excerpt, flag reasons, flagged by (guest/owner/system), action buttons: "Publish" / "Remove" (opens dialog requiring reason)
2. **All Reviews** — full list filterable by status (published/flagged/removed), property, score range; "Delete" action on each row

**AdminShell sidebar:** Add "Reviews" nav item with `Star` icon, badge showing `flagged-count` (poll every 60s via `GET /admin/reviews/flagged?limit=1` total).

**API client:** `src/lib/api/adminReviews.ts`

---

## 11. TypeScript Interfaces (Frontend)

```ts
// src/lib/api/reviews.ts (shared types)
export type ReviewStatus = 'pending' | 'published' | 'flagged' | 'removed'

export interface ReviewListItem {
  id: string
  bookingRef: string | null
  guestName: string
  scoreOverall: number
  displayScore: number
  scoreCleanliness: number
  scoreAmenities: number
  scoreAccuracy: number
  scoreValue: number
  scoreCheckin: number
  reviewText: string | null
  photoUrls: string[]
  status: ReviewStatus
  ownerReply: string | null
  ownerRepliedAt: string | null
  replyWindowEnd: string | null
  publishedAt: string | null
  submittedAt: string | null
}

export interface PropertyRatingSummary {
  ratingAvg: number | null
  ratingCount: number
  breakdown: Record<'1'|'2'|'3'|'4'|'5', number>
  dimensions: {
    cleanliness: number
    amenities: number
    accuracy: number
    value: number
    checkin: number
  }
  meetsThreshold: boolean
}
```

---

## 12. Out of Scope (MVP)

- S3 presigned photo upload flow (photos accepted as plain URL strings)
- Elasticsearch property document sync (no ES in stack)
- Redis submission mutex (DB UNIQUE constraint is sufficient)
- Admin bulk-moderation actions
- Customer review amendment
- Platform admin reply on behalf of property (OD-8-03 Option A)
- Review import / backfill for historical checkouts (OD-8-06 Option A)
- Rating display on guest-facing search (payperhour-next app; separate repo)

---

## 13. Acceptance Criteria

### Backend (Gate 1 + 2)
- [ ] `tsc --noEmit` clean
- [ ] `npx jest reviews` — all tests pass
- [ ] `POST /reviews` with valid completed booking → `201`, `status = published`, property `rating_avg` updated
- [ ] `POST /reviews` with PII in text → `201`, `status = flagged`, admin notification fired
- [ ] `POST /reviews` past `expires_at` → `410`
- [ ] `POST /reviews` duplicate booking → `409`
- [ ] `GET /properties/:id/reviews/summary` → returns null `ratingAvg` if < 5 reviews
- [ ] `POST /owner/reviews/:id/reply` → sets `owner_reply`, `owner_replied_at`, sets `reply_window_end`
- [ ] `POST /owner/reviews/:id/flag` → rate-limited (3/week per owner)
- [ ] `POST /admin/reviews/:id/moderate` with `action=remove` without reason → `400`
- [ ] Cron `expireReviews` → pending reviews past expiry become `removed`
- [ ] Rating recalc: after 5 published reviews, `rating_avg` is non-null and weighted correctly

### Frontend (Gate 3)
- [ ] `tsc --noEmit` clean, `eslint` clean, `vitest run` green
- [ ] Owner Reviews page shows real data (not mock placeholder)
- [ ] Reply dialog submits and shows reply text in row
- [ ] Admin Flagged queue lists flagged reviews with flag reasons
- [ ] Admin "Publish" action → review moves to published tab
- [ ] Admin "Remove" action → requires reason field, review disappears from flagged queue

### E2E (Gate 4)
- [ ] `npx playwright test e2e/owner-reviews.spec.ts` — all pass
- [ ] `npx playwright test e2e/admin-reviews.spec.ts` — all pass
- [ ] Full suite `npx playwright test` — 0 regressions

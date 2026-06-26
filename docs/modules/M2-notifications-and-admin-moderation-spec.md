# M2 + M2B: Owner Notification Inbox & Admin Moderation — Gate 0 Spec Lock

Status: LOCKED for Gate 1 implementation
Source: `Updated_Onboarding_Spec.docx` (PayPerHour, March 2026) §5.2.4, §6, §7.3, §8, §9;
`SuperAdmin_Dashboard_Spec.docx` §1.1 (mandatory reasoning, action queues);
`docs/modules/M1-hotel-onboarding-spec.md`; `src/common/events/domain-events.ts`

## 1. Scope boundary

M1 (Phase 2 — Property Submission) emits `hotel.onboarding.submitted` and
leaves `hotel.verified` / `hotel.rejected` undefined and no admin or
notification modules exist. M2/M2B together close the loop for **Phase 3
(Status Tracking / Limited Dashboard)**: an admin can act on a submitted
property, and the owner finds out about it.

| In scope (M2 / M2B) | Out of scope (later modules) |
|---|---|
| `notifications` schema: `Notification` model (owner inbox) | Push notifications (no mobile app yet) |
| `GET /owners/me/notifications`, `PATCH /owners/me/notifications/:id/read` | Notification preferences UI (Profile & Settings module) |
| Admin moderation queue: `GET /admin/properties`, `GET /admin/properties/:id` | Elasticsearch indexing on approval (**M4**) |
| `POST /admin/properties/:id/approve` → emits `hotel.verified` | Guided post-approval setup checklist (later module) |
| `POST /admin/properties/:id/reject` → emits `hotel.rejected` | GSTIN third-party auto-validation (Sprint-5 equivalent, deferred) |
| `POST /admin/properties/:id/request-revision` → emits new `hotel.revision_requested` | Draft-reminder / document-expiry cron emails (separate scheduling module) |
| `PropertyModerationLog` audit trail (mandatory reasoning) | Manual escalation-queue UI for `escalated` properties (ops tooling, later) |
| Revision cycle cap (3) → `status = escalated` | Welcome / OTP / draft-reminder email templates (owned by their triggering modules) |
| `NotificationDeliveryService` consuming `notification.requested` → email/SMS gateway (config-driven, mirrors `otp-delivery.service.ts`) | Branded HTML email template design, production provider accounts |
| `PropertyStatus` enum: additive `escalated` value | — |

M1's `revise` flow already reads `status`/`revisionNotes` directly off the
`Property` row, so no new event is needed in that direction. The one new
event M2B introduces is `hotel.revision_requested`, which the notifications
module needs in order to populate the owner's inbox the moment an admin
requests changes (separately from the `revise` resubmission, which reuses
the existing `hotel.onboarding.submitted`).

## 2. Data model

### 2.1 `notifications` schema (new models)

**`Notification`** (table `owner_notifications`):

| Column | Type | Notes |
|---|---|---|
| `id` | uuid PK | |
| `ownerId` | uuid | cross-schema ref to `auth.User.id`, no FK |
| `propertyId` | uuid? | cross-schema ref to `properties.Property.id`, nullable for `general` notifications |
| `type` | `NotificationType` enum | `status_change, revision_request, approval, rejection, document_verified, general` |
| `title` | `String @db.VarChar(200)` | |
| `body` | `String` (text) | |
| `actionUrl` | `String? @db.VarChar(500)` | deep link, e.g. `/owner/dashboard/documents` |
| `isRead` | `Boolean @default(false)` | |
| `createdAt` | `DateTime @default(now())` | |

`@@index([ownerId, isRead])`, `@@index([ownerId, createdAt])`,
`@@map("owner_notifications")`, `@@schema("notifications")`.

**`NotificationType`** enum — `status_change | revision_request | approval | rejection | document_verified | general`, `@@schema("notifications")`.

### 2.2 `properties` schema (additive changes)

**`PropertyStatus`** enum — add `escalated` (additive migration, per M1 §4.10):

```
draft | pending_review | needs_revision | approved | rejected | suspended | escalated
```

**`PropertyModerationLog`** (new model — audit trail for §1.1 "Mandatory
Reasoning" principle: every approve/reject/revision-request action is
recorded):

| Column | Type | Notes |
|---|---|---|
| `id` | uuid PK | |
| `propertyId` | uuid | |
| `adminId` | uuid | cross-schema ref to `auth.User.id`, no FK |
| `action` | `ModerationAction` enum | `approved, rejected, revision_requested` |
| `reason` | `String?` | required (service-layer) for `rejected`/`revision_requested`, null for `approved` |
| `revisionItems` | `Json?` | `[{ field, reason }]`, only for `revision_requested` |
| `createdAt` | `DateTime @default(now())` | |

`@@index([propertyId])`, `@@map("property_moderation_log")`, `@@schema("properties")`.

**`ModerationAction`** enum — `approved | rejected | revision_requested`, `@@schema("properties")`.

`Property.revisionCount` / `Property.revisionNotes` (already added in M1)
are now **written** by M2B instead of just read.

## 3. Domain events

### 3.1 New event

Add to `domain-events.ts`:

```ts
HOTEL_REVISION_REQUESTED: 'hotel.revision_requested',

export interface HotelRevisionRequestedPayload {
  hotelId: string;
  ownerId: string;
  requestedBy: string; // admin userId
  items: { field: string; reason: string }[];
}
```

### 3.2 Existing events now consumed

`NotificationsModule` subscribes to:

- `hotel.verified` (`HotelVerifiedPayload`) → create `Notification(type=approval)`
- `hotel.rejected` (`HotelRejectedPayload`) → create `Notification(type=rejection)`
- `hotel.revision_requested` (`HotelRevisionRequestedPayload`) → create `Notification(type=revision_request)`

Each handler also emits `notification.requested` (existing
`NOTIFICATION_REQUESTED` / `NotificationRequestedPayload`) for the matching
P0 email/SMS template from §9 (`Property approved`, `Property rejected`,
`Revision requested`). Other templates in §9 (welcome, OTP, draft reminders,
document expiry) are emitted by their owning modules, not M2.

### 3.3 `NotificationDeliveryService`

A new listener for `notification.requested`, modeled on
`otp-delivery.service.ts`:

- Resolves `recipientUserId` → `{ phone, email }` via `AuthService`
  (application-level cross-module call — allowed; only Prisma
  relations/FKs across schemas are prohibited).
- `channel = 'email'` → POST to `EMAIL_GATEWAY_URL` (new env var, same
  pattern as `SMS_GATEWAY_URL`/`SMS_GATEWAY_API_KEY`).
- `channel = 'sms'` → reuses existing `SMS_GATEWAY_URL`/`SMS_GATEWAY_API_KEY`.
- If the relevant gateway env vars are unset, **log a warning and no-op**
  (unlike `otp-delivery.service.ts`, which throws — OTP delivery is
  synchronous/blocking, but notification delivery is a best-effort async
  side effect and must not crash the event listener or the
  approve/reject/revision-request request that triggered it).
- `channel = 'push'` → no-op (no mobile app yet), logged at debug level.

## 4. API surface

### 4.1 Owner notification inbox (M2)

All routes under `/owners/me/notifications`, guarded by `JwtAuthGuard`.

| Method | Path | Purpose |
|---|---|---|
| GET | `/owners/me/notifications` | List the caller's notifications, newest first. Query params: `unread=true` (filter), `page`, `limit` (default 20). Response includes `unreadCount`. |
| PATCH | `/owners/me/notifications/:id/read` | Mark one notification as read. 404 if `id` doesn't belong to the caller (`ownerId !== user.id`). |

### 4.2 Admin moderation (M2B)

All routes under `/admin/properties`, guarded by `JwtAuthGuard` +
`RolesGuard([GlobalRole.ADMIN, GlobalRole.SUPER_ADMIN])` (existing
`RolesGuard`/`@Roles()` decorator from `auth` module).

| Method | Path | Purpose |
|---|---|---|
| GET | `/admin/properties` | Moderation queue. Query params: `status` (default `pending_review`), `page`, `limit`. Returns summary fields (id, name, ownerId, submissionRef, submittedAt, status, revisionCount). |
| GET | `/admin/properties/:id` | Full detail for one property: all onboarding fields, `RoomType[]`, `PropertyPhoto[]`, `PropertyDocument[]`, and **decrypted** `PropertyComplianceDoc` (GSTIN/PAN/bank account) via existing `EncryptionService.decrypt` — admin needs cleartext to verify against documents. |
| POST | `/admin/properties/:id/approve` | Only valid when `status = pending_review`. Sets `status = approved`. Writes `PropertyModerationLog(action=approved)`. Emits `hotel.verified`. |
| POST | `/admin/properties/:id/reject` | Body: `{ reason: string }` (required, non-empty). Only valid when `status = pending_review`. Sets `status = rejected`. Writes `PropertyModerationLog(action=rejected, reason)`. Emits `hotel.rejected`. |
| POST | `/admin/properties/:id/request-revision` | Body: `{ items: [{ field: string, reason: string }] }` (non-empty array). Only valid when `status = pending_review`. See §5.3 for the cycle-cap behaviour. Writes `PropertyModerationLog(action=revision_requested, reason, revisionItems)`. |

## 5. Edge cases & validation rules

1. **Status guard**: `approve`/`reject`/`request-revision` all require
   `Property.status === 'pending_review'` → 409 Conflict otherwise (e.g.
   can't approve a `draft`, can't re-reject an already-`rejected` property).
2. **Mandatory reasoning**: `reject` and `request-revision` require a
   non-empty `reason` (and non-empty `items[]` for revision) → 400 if
   missing/empty, per `SuperAdmin_Dashboard_Spec.docx` §1.1 Principle 5.
3. **Revision cycle cap**: on `request-revision`, if
   `Property.revisionCount + 1 > 3`, instead set `status = escalated`
   (not `needs_revision`), still write the `PropertyModerationLog` row, and
   **do not** emit `hotel.revision_requested` (emit `hotel.rejected`-style
   in-app notification of type `general` informing the owner the
   application has been escalated to the operations team — no email/SMS
   template defined yet, so `NotificationDeliveryService` no-ops for this
   case). Otherwise increment `revisionCount`, append to `revisionNotes`,
   set `status = needs_revision`, emit `hotel.revision_requested`.
4. **`escalated` is terminal for M2B**: `approve`/`reject`/`request-revision`
   on a property with `status = escalated` → 409. No endpoint exists yet to
   move out of `escalated` (manual ops process, future module).
5. **Notification ownership**: `PATCH /owners/me/notifications/:id/read` —
   404 (not 403, to avoid leaking existence) if the notification's
   `ownerId` doesn't match the authenticated user.
6. **Idempotent mark-as-read**: marking an already-read notification as read
   again is a no-op (200), not an error.
7. **Pagination defaults**: `GET /owners/me/notifications` and
   `GET /admin/properties` both default to `page=1`, `limit=20`, max
   `limit=100`.
8. **Decrypted compliance data exposure**: `GET /admin/properties/:id`
   returns cleartext GSTIN/PAN/bank details — restricted to
   `ADMIN`/`SUPER_ADMIN` via `RolesGuard`. No separate audit log of *views*
   in M2B (only of approve/reject/revision *actions*); a future compliance
   module may add view-auditing.
9. **`hotel.verified`/`hotel.rejected` payload `verifiedBy`/`rejectedBy`**:
   populated from `request.user.id` (the acting admin), matching the
   existing `HotelVerifiedPayload`/`HotelRejectedPayload` shapes — no
   payload changes needed for these two events.
10. **Notification fan-out failure isolation**: a failure in
    `NotificationDeliveryService` (e.g. gateway down) must not roll back the
    `Notification` row creation or the underlying `approve`/`reject`/
    `request-revision` transaction — delivery is fire-and-forget via
    EventEmitter2, consistent with the existing event-driven pattern.

## 6. Out-of-scope follow-ups (tracked as separate tasks)

- Notification preferences (email/SMS toggles per type) — Profile & Settings
  module.
- Elasticsearch indexing of `approved` properties — M4.
- Post-approval guided setup checklist — later module.
- Draft-reminder (7-day) and draft-expiry (80-day) emails, document-expiry
  reminders — require a scheduling/cron module, not part of M2.
- Manual escalation-queue UI/workflow for `escalated` properties — ops
  tooling, future module.
- Production email/SMS provider accounts and branded HTML templates —
  `NotificationDeliveryService` is built against configurable gateway URLs
  (mirroring `otp-delivery.service.ts`); actual provider setup is an infra
  task, not a code task.

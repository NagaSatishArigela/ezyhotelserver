# M9 — Owner Notification Inbox

## 1. Overview

Surface in-app notifications to the owner via a bell badge in the portal header and a full inbox page. The backend listener infrastructure is already built (M2/M3); M9 adds the two missing API endpoints, two missing event listeners, and the complete frontend.

---

## 2. Backend Additions (incremental to existing NotificationsModule)

### 2.1 New endpoints

| Method | Path | Description |
|--------|------|-------------|
| GET | `/owners/me/notifications/unread-count` | Returns `{ count: number }` — used for bell badge polling |
| PATCH | `/owners/me/notifications/read-all` | Marks all unread notifications for caller as read. Returns `{ updated: number }` |

Existing endpoints (unchanged):
- `GET /owners/me/notifications?page&limit&unread` → paginated list with `unreadCount`
- `PATCH /owners/me/notifications/:id/read` → mark single as read

### 2.2 New event listeners

**`PayoutReleasedListener`** — listens to `DOMAIN_EVENTS.PAYOUT_RELEASED`:
```
type: payout_released
title: "Payout released — {batchRef}"
body: "₹{net} has been credited to your bank account."
actionUrl: /owner/payouts
```

**`ReviewEventsListener`** — listens to `DOMAIN_EVENTS.REVIEW_NEW_ON_PROPERTY`:
```
type: review_new_on_property
title: "New review on your property"
body: "A guest left a {score}/5 review. Reply within 96 hours."
actionUrl: /owner/reviews
```

---

## 3. Notification Types (existing enum in schema)

Already present: `booking_update`, `approval`, `rejection`, `revision_request`, `review_new_on_property`, `review_reply_window_reminder`, `payout_released`

---

## 4. Frontend

### 4.1 Bell badge in OwnerShell header

- Polls `GET /owners/me/notifications/unread-count` every **60 seconds** (using TanStack Query `refetchInterval`)
- Shows orange badge with count when `count > 0`; hides badge when `count === 0`
- Clicking the bell opens a **notification dropdown panel**

### 4.2 Notification dropdown

- Fetches last 10 notifications (`limit=10, page=1`)
- Each row: icon (by type), title, body (truncated to 1 line), relative time, unread dot
- Clicking a row: marks it read (PATCH /:id/read), navigates to `actionUrl`
- Footer: "Mark all as read" button + "View all →" link to `/owner/notifications`
- Closes on outside click (Radix Popover)

### 4.3 `/owner/notifications` page

- Route: `/owner/_portal/notifications` (new file-based route)
- Paginated table: columns = Type icon, Title, Body, Time, Read status
- Filter toggle: "All" / "Unread only"
- "Mark all as read" button in page header
- Clicking a row marks it read and navigates to `actionUrl` if set
- Empty state: "You're all caught up."

### 4.4 Notification type icons & colours

| Type | Icon | Colour |
|------|------|--------|
| `booking_update` | `CalendarDays` | `text-primary-600` |
| `approval` | `CheckCircle` | `text-success-600` |
| `rejection` | `XCircle` | `text-error-500` |
| `revision_request` | `AlertTriangle` | `text-warning-600` |
| `review_new_on_property` | `Star` | `text-primary-600` |
| `review_reply_window_reminder` | `MessageSquare` | `text-navy-500` |
| `payout_released` | `Wallet` | `text-success-600` |
| default | `Bell` | `text-navy-400` |

---

## 5. Polling Strategy

- Bell badge: `refetchInterval: 60_000` (1 minute), enabled only when owner is authenticated
- Dropdown list: fetched on-demand when popover opens, `staleTime: 30_000`
- After marking read: `invalidateQueries(['notifications-unread-count'])` so badge updates immediately

---

## 6. Test Strategy

**Unit tests (backend):**
- `markAllRead`: updates correct count, returns `{ updated: N }`
- `unreadCount`: returns correct count
- `PayoutReleasedListener`: creates notification with correct type/title/body
- `ReviewEventsListener`: creates notification with correct score in body

**E2E (Playwright):**
- Bell badge shows count when unread notifications exist
- Bell badge hidden when count is 0
- Dropdown opens on click, shows notification rows
- Clicking a row marks it read (badge decrements)
- "Mark all as read" clears badge
- Notifications page: list, unread filter, mark-all-read

---

## 7. Out of Scope

- Push notifications (FCM/APNS)
- Email/SMS delivery (handled by `NOTIFICATION_REQUESTED` event, already stubbed)
- Admin notification inbox (admin uses different communication channels)
- Notification preferences / opt-out settings

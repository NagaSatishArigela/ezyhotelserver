# M10 — Super Admin Portal (Platform Governance)

## 1. Purpose

Super Admin is the **platform governance layer** that sits above the operational Admin portal.
A `SUPER_ADMIN` user can do everything an `ADMIN` can do, plus:

- See platform-wide KPI aggregates
- Create, deactivate, and reactivate Admin accounts
- Read and update global platform settings (commission, payout schedule, etc.)

Regular Admins cannot access any `/super-admin/*` endpoints.

---

## 2. Roles

| Role | Access |
|------|--------|
| `USER` | Owner portal only |
| `ADMIN` | Admin Console (`/admin/*`) |
| `SUPER_ADMIN` | Admin Console + Super Admin Portal (`/super-admin/*`) |

---

## 3. Backend API

All endpoints require `JwtAuthGuard` + `RolesGuard` + `@Roles(GlobalRole.SUPER_ADMIN)`.
Base path: `/super-admin`

### 3.1 Platform Stats — `GET /super-admin/stats`

Response:
```json
{
  "totalProperties": 142,
  "activeProperties": 118,
  "totalBookings": 8432,
  "bookingsThisMonth": 412,
  "grossRevenuePaise": 184200000,
  "grossRevenueThisMonthPaise": 9100000,
  "totalPayoutsReleasedPaise": 156000000,
  "totalTdsPaise": 1560000,
  "activeAdmins": 4,
  "totalOwners": 138,
  "activeBookings": 23
}
```

Raw SQL aggregation across `properties`, `bookings`, `payouts` schemas.
Month = current calendar month (UTC).

### 3.2 Admin Users — `GET /super-admin/admins`

Query params: `page` (default 1), `limit` (default 20)

Response:
```json
{
  "items": [
    {
      "id": "uuid",
      "name": "Ankit Verma",
      "phone": "+919988776655",
      "email": "ankit@stayflex.in",
      "globalRole": "ADMIN",
      "status": "ACTIVE",
      "createdAt": "ISO"
    }
  ],
  "total": 5,
  "page": 1,
  "limit": 20
}
```

Returns all users where `globalRole IN (ADMIN, SUPER_ADMIN)`.

### 3.3 Create Admin — `POST /super-admin/admins`

Body: `{ name: string, phone: string, email?: string }`  
Creates user with `globalRole = ADMIN`, `status = ACTIVE`, random password (user must reset via OTP).  
Returns the created admin user object.

### 3.4 Toggle Admin Status — `PATCH /super-admin/admins/:id/status`

Body: `{ status: 'ACTIVE' | 'SUSPENDED' }`  
Cannot toggle own account (403).  
Cannot suspend another `SUPER_ADMIN` (403).  
Returns updated user.

### 3.5 Get Platform Settings — `GET /super-admin/settings`

Returns `PlatformSettings` singleton.

### 3.6 Update Platform Settings — `PATCH /super-admin/settings`

Body: partial `PlatformSettings` fields.  
Records `updatedBy` from JWT.

---

## 4. Prisma — `platform` schema

```prisma
model PlatformSettings {
  id                     String   @id @default("singleton")
  commissionPct          Decimal  @default(15.00)
  tdsPct                 Decimal  @default(1.00)
  payoutDayOfWeek        Int      @default(1)    // 0=Sun..6=Sat
  minBookingHours        Int      @default(1)
  maxBookingHours        Int      @default(24)
  cancellationWindowHours Int     @default(24)
  updatedAt              DateTime @updatedAt
  updatedBy              String?

  @@schema("platform")
}
```

Seeded with one row (`id = 'singleton'`) in the migration.

---

## 5. Frontend — Super Admin Portal

### 5.1 Theme (CRITICAL)

**Light/brand theme only. Zero `admin-*` tokens.**

| Element | Token |
|---------|-------|
| Page background | `bg-navy-50` |
| Sidebar | `bg-white border-r border-border` |
| Active nav | `bg-primary-50 text-primary-600 border-l-[3px] border-primary-600` |
| Idle nav | `text-navy-600 hover:bg-navy-50` |
| Header | `bg-white border-b border-border` |
| Primary text | `text-navy-900` |
| Secondary text | `text-navy-500` |

### 5.2 Routes

```
/super-admin/dashboard   → Platform Dashboard (KPI cards)
/super-admin/admins      → Admin Users (table + create + toggle)
/super-admin/settings    → Platform Settings (form)
```

Route guard: `requireAuth('super_admin')` — redirects to `/login` if role is not `super_admin`.

### 5.3 Pages

**Dashboard** — 6 KPI cards (Total Properties, Active Bookings, Revenue MTD, Payouts Released, TDS Collected, Active Admins)

**Admin Users** — table: Name / Role / Status / Created / Actions  
- Create Admin button → dialog (name + phone + optional email)
- Suspend / Activate toggle button per row (disabled for own account + other super admins)

**Platform Settings** — form fields:
- Commission % (0–30, step 0.5)
- TDS % (read-only display, 1% per §194O)
- Payout day (Mon–Sun selector)
- Min booking hours (1–4)
- Max booking hours (8–48)
- Cancellation window hours (0–72)
- Save button

### 5.4 Demo User

```
email:    superadmin@demo.com
password: demo1234
role:     super_admin
name:     Vikram Reddy
```

After login, redirect to `/super-admin/dashboard`.

---

## 6. Edge Cases

| Case | Behaviour |
|------|-----------|
| Super admin tries to suspend self | 403 — "Cannot suspend your own account" |
| Super admin tries to suspend another super admin | 403 — "Cannot suspend a Super Admin" |
| `commissionPct` submitted < 0 or > 30 | 400 validation error |
| `payoutDayOfWeek` submitted outside 0–6 | 400 validation error |
| No `PlatformSettings` row exists yet | GET upserts the singleton on first read |

# M4: Property Search & Discovery (Postgres-backed) — Gate 0 Spec Lock

Status: LOCKED for Gate 1 implementation
Source: `docs/modules/M1-hotel-onboarding-spec.md` §1 ("Elasticsearch indexing on
approval (**M4**)"), `docs/modules/M3-booking-engine-spec.md` §1 ("Elasticsearch
indexing / search (**M4**)"); existing `GET /properties/public` endpoint
(`src/modules/properties/public/*`); `payperhour-next/types/index.ts`
`FilterParams` contract; `BookingsRepository.findOverlappingForAvailability`
(M3) for availability-aware filtering.

## 1. Scope boundary

M1 and M3 deferred "Elasticsearch indexing/search" to M4. The current stack
has no Elasticsearch (or any search) infrastructure — it is a single Postgres
modular monolith. Per product decision, M4 implements the **actual goal**
behind that deferred line item — fast, filterable, availability-aware
property discovery matching the existing frontend `FilterParams` contract —
using Postgres full-text search and indexes against the existing `properties`
and `bookings` schemas. No new infrastructure is introduced. The query
contract (`GET /properties/public` request/response shapes) is designed so a
future Elasticsearch-backed implementation could be swapped in without
changing the API.

| In scope (M4) | Out of scope (later modules) |
|---|---|
| Extend `GET /properties/public` query params to match `FilterParams`: `q`, `city`, `minPrice`, `maxPrice`, `amenities` | Real Elasticsearch / OpenSearch deployment (deferred indefinitely; API contract kept swap-compatible) |
| Postgres full-text search (`pg_trgm`) on `name`, `description`, `landmark` for `q` | Geo-radius / map-based "near me" search, lat-long distance sorting (**later module**) |
| `@@index` additions: city, GIN trigram on searchable text, GIN on `amenities` array | `rating` filter — **no `Review`/`reviews` model exists in any schema yet** (reviews module not built). Accepted as a query param but ignored (no-op) until that module ships (**M-future**) |
| Price-range filter (`minPrice`/`maxPrice`) against `RoomType.hourlyRatePaise` | Personalized/ML ranking, click-through relevance tuning |
| Sorting: `relevance` (when `q` present, default), `price_asc`, `price_desc`, `newest` | Admin-side search/reporting tools (separate concern) |
| Availability-aware filtering: optional `checkInAt` + `durationHours` (+ `bookingType`) params exclude properties with zero available rooms for that slot, reusing M3's overlap-check logic | Saved searches / search alerts |
| `payperhour-next` `/hotels` page: wire real-mode (UUID) search to the extended `/properties/public` endpoint, alongside the existing static-catalog mode | Replacing the static `hotelsData.ts` catalog entirely |

## 2. Data model

No new tables or schemas. Additive indexes on the existing `properties.Property`
model (`prisma/schema.prisma`).

### 2.1 Postgres extension

Enable `pg_trgm` for trigram-based fuzzy/substring text search:

```prisma
generator client {
  provider        = "prisma-client-js"
  previewFeatures = ["postgresqlExtensions"]
}

datasource db {
  provider   = "postgresql"
  url        = env("DATABASE_URL")
  schemas    = ["auth", "properties", "bookings", "finance", "notifications", "reviews", "compliance"]
  extensions = [pgTrgm]
}
```

### 2.2 `Property` index additions

| Index | Type | Purpose |
|---|---|---|
| `@@index([city])` | btree | exact-match `city` filter |
| `@@index([name, description, landmark], type: Gin, ops: ...TrigramOps)` | GIN trigram | `q` substring/fuzzy search across name, description, landmark |
| `@@index([amenities], type: Gin)` | GIN | `amenities` array-contains filter (`hasEvery`) |

(Trigram indexes are defined per-column in Prisma; the migration adds three
single-column GIN trigram indexes — `name`, `description`, `landmark` — rather
than one composite index, since Prisma's `Gin`/`ops` support is per-field.)

### 2.3 `RoomType` (no schema change)

`hourlyRatePaise`/`fulldayRatePaise` already exist and are indexed via the
existing `@@index([propertyId])`. Price-range filtering joins `RoomType` by
`propertyId` (already the pattern used in `findRoomTypesForProperties`); no
new index needed at current data volumes — revisit if `EXPLAIN` shows a
sequential scan once the catalog grows.

## 3. Query contract — `GET /properties/public`

Extends `ListPublicPropertiesQueryDto` (currently `page`, `limit` only).

| Param | Type | Notes |
|---|---|---|
| `page` | `number`, default 1, min 1 | unchanged |
| `limit` | `number`, default 20, min 1, max 50 | unchanged |
| `q` | `string?`, max 100 chars | matched against `name`, `description`, `landmark`, `city` via `pg_trgm` similarity / `ILIKE '%term%'` |
| `city` | `string?` | case-insensitive exact match (`equals`, `mode: 'insensitive'`) — mirrors current static `filterHotels` behaviour |
| `minPrice` | `number?`, paise, min 0 | property included if **any** `RoomType.hourlyRatePaise >= minPrice` |
| `maxPrice` | `number?`, paise, min 0 | property included if **any** `RoomType.hourlyRatePaise <= maxPrice` |
| `amenities` | `string?` | comma-separated list; property must have **all** listed amenities (`hasEvery`) — mirrors current static `.every()` behaviour |
| `rating` | `string?` | **accepted but ignored** (no `Review` model yet — see §1). Validated as a number for forward compatibility, has no filtering effect |
| `checkInAt` | `ISO datetime string?` | optional availability filter — see §4 |
| `durationHours` | `number?`, min 1 | required if `checkInAt` given; default `Property.minBookingHours` semantics not assumed — must be explicit |
| `bookingType` | `'hourly' \| 'fullday'?` | default `hourly`; required to compute `checkOutAt` for the overlap check |
| `sort` | `'relevance' \| 'price_asc' \| 'price_desc' \| 'newest'?` | default: `relevance` if `q` present, else `newest` |

All filters are AND-combined. Response shape (`PublicPropertyListResult`)
is **unchanged** — `{ items: PublicPropertySummary[], total, page, limit }` —
preserving the existing contract for both `payperhour-next` and any future
Elasticsearch-backed swap.

### 3.1 Frontend mapping (`FilterParams` → query params)

`payperhour-next`'s `FilterParams` (`q`, `city`, `minPrice`, `maxPrice`,
`amenities`, `rating`) maps 1:1 to the params above except `minPrice`/`maxPrice`,
which the frontend currently expresses in rupees (matching `Hotel.price` in
`hotelsData.ts`); the API client converts rupees → paise (`* 100`) before
calling `/properties/public`.

## 4. Availability-aware filtering

When `checkInAt` + `durationHours` (+ optional `bookingType`, default `hourly`)
are supplied, the result set is restricted to properties that have **at least
one `RoomType`** with `count > available-overlapping-bookings` for the
requested window — i.e. the same per-room-type capacity check M3's
`createWithOverlapCheck` enforces at booking time
(`BookingsRepository.findOverlappingForAvailability`), applied here as a
**read-only filter** across all room types of each candidate property:

1. Compute `checkOutAt` from `checkInAt` + `durationHours` (hourly) or end-of-day
   per `defaultCheckoutTime` (fullday) — same formula as M3 §3.
2. For each `RoomType` belonging to a candidate property, count active
   (`pending_payment | confirmed | checked_in`) bookings overlapping
   `[checkInAt, checkOutAt)`.
3. Property is included if **any** of its room types has
   `overlappingCount < RoomType.count`.

This is implemented as a single query against `bookings.Booking` grouped by
`roomTypeId` (cross-schema application-level join per the modular-monolith
isolation rule — plain UUID lookups, no Prisma relations across schemas),
intersected with the candidate property/room-type ids from step 1's filters.
Properties with **zero room types** (incomplete onboarding — should not occur
for `approved` properties, but defensively) are excluded when an availability
filter is active.

If `checkInAt`/`durationHours` are omitted, availability filtering is skipped
entirely (current behaviour — matches existing `/properties/public`).

## 5. Sorting

| `sort` value | Order |
|---|---|
| `relevance` (default when `q` set) | `pg_trgm` similarity score on `name`/`description`/`landmark`/`city` (highest first); ties broken by `createdAt desc` |
| `price_asc` | `MIN(RoomType.hourlyRatePaise)` ascending (nulls last) |
| `price_desc` | `MIN(RoomType.hourlyRatePaise)` descending (nulls last) |
| `newest` (default when no `q`) | `createdAt desc` — unchanged from current behaviour |

## 6. Edge cases

- **Empty/whitespace `q`**: treated as absent (no text filter, falls back to
  `newest` sort unless another `sort` is explicit).
- **`minPrice` > `maxPrice`**: returns empty result set (no error) — same
  permissive behaviour as the static `filterHotels`.
- **`amenities` with unknown values**: properties simply won't match
  (`hasEvery` on a non-existent amenity yields no match) — no validation
  against a fixed amenity list (matches current static behaviour).
- **`checkInAt` in the past**: not rejected — availability is computed
  literally against the given window; a past window will typically show all
  properties as "available" (no future bookings overlap it), which is
  acceptable since the booking-creation endpoint (M3) independently rejects
  past `checkInAt`.
- **`durationHours` present without `checkInAt`** (or vice versa): `400
  Bad Request` — both or neither.
- **`rating` provided**: accepted, validated as numeric if present, but does
  not affect results. No properties are excluded based on rating until a
  Reviews module exists.
- **Properties with no `RoomType` rows** (`startingHourlyRatePaise`/
  `startingFulldayRatePaise` both `null`): excluded from `minPrice`/`maxPrice`
  filtering results (can't satisfy a price bound with no price), but still
  appear in unfiltered/`q`-only/`city`-only searches — unchanged from current
  `toSummary()` behaviour where these fields are simply `null`.

## 7. Out-of-scope confirmation (for future planning)

- A real Elasticsearch/OpenSearch index remains deferred indefinitely. If
  introduced later, it would sit behind the same `GET /properties/public`
  contract (params in §3, response shape unchanged) as a drop-in replacement
  for the query logic in `PublicPropertiesService`/`PropertiesRepository` —
  no frontend or API-contract changes required.
- `rating` filtering activates only once a `reviews` schema with a `Review`
  model (aggregatable to a per-property average) exists. At that point §3's
  `rating` param gains a `having avgRating >= rating` clause; no contract
  change needed since the param already exists (currently a no-op).
- Geo/map-based search (radius, "near me") is a distinct feature requiring
  `latitude`/`longitude` query params and PostGIS or simple haversine
  ordering — not addressed here.

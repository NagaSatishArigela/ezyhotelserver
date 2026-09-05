# EzyHotels Onboarding — Frozen Server Contract (Phase 2A)

**Status: FROZEN.** This is the source of truth the portal and uploads lanes
build against. Do not diverge without a contract revision. Migration:
`prisma/migrations/20260721000100_onboarding_contract`.

The wizard has 5 steps saved via `PATCH /properties/:id/step/:stepNum`
(steps 1–4 merge into `draftData`; step 5 writes to the compliance schema).
`POST /properties/:id/submit` (and `PATCH /properties/:id/revise`) re-validate
every step and enforce the cross-step conditional rules described below.

All rupee amounts in step 3 are **rupees** in the payload; the server converts
to paise integers on submit.

---

## 1. Step payloads

### Step 1 — Basics (`step1`)

| Field | Type | Required | Rules |
|---|---|---|---|
| `propertyName` | string | yes | 3–100 chars |
| `propertyType` | enum `PropertyType` | yes | `hotel \| resort \| homestay \| villa \| pg \| farm \| banquet \| other` |
| `bookingPolicy` | enum `BookingPolicy` | yes | `hourly \| fullday \| both` |
| `businessEntity` | enum `BusinessEntity` | **yes (new)** | `individual \| sole_proprietor \| partnership \| llp \| private_limited \| public_limited` |
| `ownerFirstName` | string | yes | 2–50 chars, regex `^[A-Za-z][A-Za-z .'-]*$` (letters + space/hyphen/apostrophe/dot) |
| `ownerMiddleName` | string | no | ≤50 chars |
| `ownerLastName` | string | yes | 2–50 chars, same regex as first name |
| `category` | enum `PropertyCategory` | yes | `budget \| mid \| premium` |
| `description` | string | no | ≤200 chars, HTML stripped |

> **Owner-name change:** the previous `^[A-Za-z]+$` rule (which rejected real
> names) is replaced by `^[A-Za-z][A-Za-z .'-]*$`. Min length unchanged.

### Step 2 — Location (`step2`)

| Field | Type | Required | Rules |
|---|---|---|---|
| `latitude` | number | yes | valid latitude |
| `longitude` | number | yes | valid longitude |
| `addressLine1` | string | yes | 5–150 chars |
| `addressLine2` | string | yes | 5–300 chars |
| `pincode` | string | yes | `^\d{6}$` |
| `city` | string | yes | 2–80 chars |
| `state` | string | yes | ≥2 chars |
| `landmark` | string | no | ≤100 chars |
| `specialNote` | string | no | ≤200 chars, HTML stripped |

### Step 3 — Rooms / Policies / House rules (`step3`)

| Field | Type | Required | Rules |
|---|---|---|---|
| `rooms` | `RoomType[]` | yes | ≥1 room must have `count > 0` (submit) |
| `minBookingHours` | enum string | conditional | `'1' \| '2' \| '3'`; required at submit unless `bookingPolicy === 'fullday'` |
| `defaultCheckinTime` | string | no | `HH:MM`; defaults to `12:00` on submit |
| `defaultCheckoutTime` | string | no | `HH:MM`; defaults to `11:00` on submit |
| `seatingCapacity` | int | conditional | 50–5000; required at submit when `propertyType === 'banquet'` |
| `amenities` | string[] | yes | ≥1; **amenity ids** (see §2) |
| `houseRules` | object | yes | see below |

`RoomType`: `type` (`ac \| nonac \| dorm \| suite`), `count` (int 0–500),
`hourlyRate` (rupees 100–100000, required at submit for `hourly`/`both`),
`fulldayRate` (rupees 500–500000, required at submit for `fullday`/`both`),
`maxOccupancy` (int 1–20, optional).

`houseRules`: `couple_friendly`/`pet_friendly`/`party_allowed`/`outside_food`
(`yes\|no\|on_request`), `alcohol_allowed` (`yes\|no\|not_allowed`),
`smoking_allowed` (`yes\|no\|designated_area`), `bachelor_groups`/
`id_proof_required` (`yes\|no`), plus optional `noiseCutoffTime`,
`alcoholPolicyNote` (≤200).

### Step 4 — Photos (`step4`)

| Field | Type | Required | Rules |
|---|---|---|---|
| `photos` | `Photo[]` | yes | ≤25 total; ≤10 per category |

`Photo`: `category` (`exterior \| room \| reception \| washroom \| common`),
`url` (string), `isPrimary` (bool, optional), `sortOrder` (int ≥0, optional).

### Step 5 — Legal & Payout (`step5`, compliance schema)

| Field | Type | Required | Rules |
|---|---|---|---|
| `gstin` | string | **conditional (new)** | regex `^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$` **only when present**; required unless `businessEntity ∈ {individual, sole_proprietor}` (enforced at submit) |
| `legalBusinessName` | string | yes | 2–200 chars |
| `pan` | string | yes | `^[A-Z]{5}[0-9]{4}[A-Z]$` |
| `bankAccountNumber` | string | yes | `^\d{9,18}$` |
| `ifsc` | string | yes | `^[A-Z]{4}0[A-Z0-9]{6}$` |
| `accountHolderName` | string | yes | 2–100 chars |
| `tcAccepted` | literal `true` | yes | must be `true` |
| `formCAcknowledged` | literal `true` | yes | must be `true` |
| `documents` | `Document[]` | no | ≤20; `{ type: DocumentType, url: string, expiresAt?: ISO8601 }` |

GSTIN/PAN/bank number are stored AES-256-GCM encrypted; only masked values are
returned to owners. `gstinHash` is a **nullable unique** column — GSTIN-less
docs (individual/sole_proprietor) store `NULL` and never collide.

---

## 2. Canonical amenity ids (FROZEN vocabulary)

Step 3 `amenities` carries these ids (not display phrases). Portal picker must
map to exactly these:

```
wifi, ac, parking, pool, gym, restaurant, bar, spa, reception_24,
room_service, laundry, conference, rooftop, couples, pets, wheelchair,
cctv, ev_charging
```

Compliance gates (id-based, evaluated at submit):

- **REQUIRES_FSSAI** = `restaurant`, `bar`, `room_service` → if any selected, a
  `fssai_license` document is required.
- **REQUIRES_POOL_SAFETY** = `pool` → informational (not blocking) unless
  otherwise enforced.

---

## 3. DocumentType enum + portal docId map

`DocumentType` (compliance schema): `owner_photo`, `id_proof`, `pan_card`,
`gstin_certificate`, `rental_agreement`, `fire_safety_cert`, `fssai_license`,
`trade_license`, `partnership_deed` (new), `incorporation_certificate` (new),
`board_resolution` (new), `llp_agreement` (new), `cancelled_cheque` (new),
`other`.

Portal / uploads `docId → DocumentType`:

| portal docId | DocumentType |
|---|---|
| `pan` | `pan_card` |
| `aadhaar` | `id_proof` |
| `ownership` | `rental_agreement` |
| `gst_cert` | `gstin_certificate` |
| `fire_noc` | `fire_safety_cert` |
| `trade` | `trade_license` |
| `cheque` | `cancelled_cheque` |
| `director` | `board_resolution` |

---

## 4. businessEntity → required-documents matrix (submit)

Every submission always requires `fire_safety_cert`. `fssai_license` is added
when FSSAI-gating amenities are selected (§2). On top of that, by entity:

| businessEntity | Extra required documents | GSTIN required? |
|---|---|---|
| `individual` | none | no |
| `sole_proprietor` | none | no |
| `partnership` | `partnership_deed` | yes |
| `llp` | `llp_agreement` + `incorporation_certificate` | yes |
| `private_limited` | `incorporation_certificate` + `board_resolution` | yes |
| `public_limited` | `incorporation_certificate` + `board_resolution` | yes |

Missing items surface as `400 { step: 5, errors: [{ field, constraints }] }`.
The GSTIN-conditional error uses `field: 'gstin'`; document errors use
`field: 'documents'`.

---

## 5. GSTIN-conditional rule (summary)

- **DTO level (per-step save):** `gstin` is optional; the GSTIN regex is applied
  only when a value is present.
- **Submit level:** GSTIN must be present unless
  `businessEntity ∈ {individual, sole_proprietor}`. There is **no turnover
  field** — the entity type alone drives the requirement.

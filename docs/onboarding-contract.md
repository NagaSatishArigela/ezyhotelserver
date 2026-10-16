# EzyHotels Onboarding — Frozen Server Contract (Phase 2A)

**Status: revised October 14, 2026 for accommodation services.** This is the source of truth the portal and uploads lanes
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
| `propertyType` | enum `PropertyType` | yes | `hotel \| resort \| villa \| guest_house \| farm \| homestay \| pg \| lodge \| dormitory \| banquet \| other` |
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
`maxOccupancy` (int 1–20 for regular rooms, 1–500 for dormitories, optional).
Dorm rooms require `dormitory` specifications; see the October 2026 revision below.

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
| `gstin` | string | optional | regex `^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$` **only when present**; optional for all business entities |
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

- `restaurant`, `bar`, `room_service` show the optional `fssai_license`
  upload in the portal. Its absence does not block submission, including PG listings.
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

`fire_safety_cert` and `fssai_license` are optional for submission.
Required entity documents remain:

| businessEntity | Extra required documents | GSTIN required? |
|---|---|---|
| `individual` | none | no |
| `sole_proprietor` | none | no |
| `partnership` | `partnership_deed` | no |
| `llp` | `llp_agreement` + `incorporation_certificate` | no |
| `private_limited` | `incorporation_certificate` + `board_resolution` | no |
| `public_limited` | `incorporation_certificate` + `board_resolution` | no |

Missing items surface as `400 { step: 5, errors: [{ field, constraints }] }`.
Document errors use `field: 'documents'`.

---

## 5. Optional GSTIN (summary)

- **DTO level (per-step save):** `gstin` is optional; the GSTIN regex is applied
  only when a value is present.
- **Submit level:** GSTIN is optional for every business entity. Entity-specific
  document requirements still apply. The portal separately retains its current
  KYC upload requirements; see the merge review in the portal repository.


## October 2026 accommodation revision

Source: Dormitory.pdf, Other Accomidation Services.pdf and the supplied service-order image.
Migration: `20261014180000_accommodation_details`. Deploy this migration before the updated API and portal.
The service picker order is Hotels, Resorts, Villas, Guest Houses, Farm Houses,
Homestays, PGs, Lodges, Dormitories, Banquet/Convention Hall, Others.
Existing identifiers `farm`, `banquet` and `other` are retained.

Step 1 accepts optional `otherAccommodation` when `propertyType` is `other`. New portal selections collect the complete object; legacy drafts can omit it:
- `type`: `container_home`, `tents_glamping`, or `tree_house`.
- `numberOfBeds`: integer 1–500 (portal dropdown).
- All remaining fields are explicit `yes` / `no` answers: `windows`, `bathroom`,
  `roofInstallation`, `rainWaterProtection`, `sunRoof`, `electricity`,
  `familiesAllowed`, `groupPartiesAllowed`, `soloAccommodationAllowed`,
  `childrenBeds`, `hotWater`, `accommodationService`, `lockDoor`,
  `privacyProtection`, `pillowBlanket`, `luggageStorage`, `housekeeping`, `chargingSockets`.

Step 3 rooms with `type: dorm` accept optional `dormitory`. The new `dormitory` property service requires these specifications and room capacity at submission; legacy dorm rooms can omit them:
- `roomName`: room number/name, 1–100 characters.
- `totalBeds`: integer 1–500. `maxOccupancy` is room capacity and must not exceed this count.
- `bedLength`, `bedWidth`: 0.1–500 cm.
- `accommodationAllowedFor`: Male dormitory, Female dormitory, Mixed-gender dormitory, Private room for family / group.
- `category`: Standard, Deluxe, AC, Non-AC, Capsule / Pod, Bunk-bed room.
- `bedType`: Single bunk, Upper bunk, Lower bunk, Single bed, Capsule / Pod.
- `bedAllocation`: Upper, Lower, Any available bed.
- `sleepingArrangement`: Shared room, Private dormitory room.
- `attachedBathroom`, `privacyScreen`: Yes / No.
- `bathroomType`: Attached / Common.
- `lockerAvailability`: Individual locker / Shared locker / None.
- `mattressType`: Standard / Orthopedic / Other.
- `linenProvided`: array of Bedsheet, Pillow, Blanket; empty means none supplied.
- `chargingPoint`, `readingLight`: Each bed / Shared.

Dormitory properties must contain dorm rooms. Existing Other/dorm drafts remain valid without the new optional fields. Provided specifications are fully validated. Inactive details are omitted by the
portal and cleared when materializing a different service/room type. The structured
JSON is persisted on Property/RoomType and returned in admin/public detail responses.

The `20261016000000_dormitory_room_variants` migration replaces the unique
(property_id, type) index with a nonunique index so multiple named dormitory
variants can coexist. Existing rows and booking room IDs remain intact. Public
search accepts an optional `propertyType` filter; omitted filters keep existing
behavior. Amenity filters accept canonical IDs and historical display labels.


## Reception contacts — all eleven services

Migration: `20261016010000_reception_contacts` adds nullable columns to preserve
existing properties. Portal property details and owner settings collect:
- `receptionMobile`: Office Reception mobile number, **required before submission**
  for every service category. Indian 10-digit mobile beginning 6–9; optional +91
  prefix/spaces are normalized to ten digits. The owner's login phone stays separate.
- `receptionLandline`: optional reception landline, including STD code. Formatting
  spaces/hyphens/parentheses are removed; 6–15 digits with optional + prefix. Blank
  means no landline; owner settings can clear it using null or an empty string.

Step 1 drafts can be saved before the required mobile is entered; submit/revise
reject a missing mobile with a step-1 field error. Existing live properties remain
available. Admin verification and owner review show both fields. These operational
contacts are not added to the public guest API.

Property SMS/status notifications resolve the reception mobile for the property
and its owner; existing properties without one retain owner-phone delivery. Guest
notifications and email recipients retain their existing routing. Owner booking,
review, payout and rejection notifications use SMS template `property_notification`
with `title`, `body` and `propertyId` data; configure that template in the existing
SMS gateway. Existing approval/revision SMS templates are retained without duplicate
messages. Delivery remains best effort when no SMS gateway is configured.


## Compatibility and document access corrections

Owner settings now save reception contacts separately from booking defaults and
listing availability. Existing owners can pause/resume a listing or change defaults
without entering a new reception mobile; saving contacts and submitting onboarding
still require a valid mobile. Local legacy property types `boutique` and
`service_apt` normalize to `hotel` and `homestay` when the portal resumes a draft.

Only legacy photo paths are served publicly from the local uploads directory.
New uploads use the authenticated `/uploads/presign` object-storage flow from
develop. Configure S3-compatible storage for new uploads. New document references
use `/uploads/documents/:propertyId/:file`; authenticated applicant/admin access
returns a signed read URL valid for 60 seconds.

Existing `/uploads/:propertyId/document/:fileName` references remain readable
through the same JWT and application-access guards. Existing encrypted files under
`private-uploads/` and older files under `uploads/` remain in place. Portal previews
retrieve these legacy documents as blobs and revoke browser object URLs on cleanup.
`UPLOAD_STORAGE_ROOT` selects their persistent storage mount and defaults to the
current working directory. No existing files are moved or deleted.

Set `S3_PRIVATE_BUCKET` to a bucket with public access disabled. The inherited
storage implementation falls back to `S3_BUCKET` when this value is absent; this
fallback remains a deployment/security follow-up.

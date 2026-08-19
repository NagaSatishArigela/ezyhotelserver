/**
 * Frozen amenity vocabulary for QuickNest onboarding (Phase 2A contract).
 *
 * Amenities are ID-BASED: Step 3 `amenities: string[]` carries these stable
 * ids, and the compliance gates below match on ids (not display phrases).
 * The canonical id list is published in docs/onboarding-contract.md and MUST
 * stay in sync with the portal's amenity picker.
 */
export const AMENITY_IDS = [
  'wifi',
  'ac',
  'parking',
  'pool',
  'gym',
  'restaurant',
  'bar',
  'spa',
  'reception_24',
  'room_service',
  'laundry',
  'conference',
  'rooftop',
  'couples',
  'pets',
  'wheelchair',
  'cctv',
  'ev_charging',
] as const;

export type AmenityId = (typeof AMENITY_IDS)[number];

/**
 * Amenity ids that make an FSSAI license mandatory at submission time
 * (M1 spec edge case 6). Food/beverage service on premises.
 */
export const REQUIRES_FSSAI: AmenityId[] = ['restaurant', 'bar', 'room_service'];

/**
 * Amenity ids that trigger the pool-safety requirement. Informational unless
 * already enforced elsewhere - kept id-based for a stable contract.
 */
export const REQUIRES_POOL_SAFETY: AmenityId[] = ['pool'];

/**
 * Amenity vocabulary for EzyHotels onboarding, including the PDF additions.
 *
 * Amenities are ID-BASED: Step 3 `amenities: string[]` carries these stable
 * ids, and the compliance gates below match on ids (not display phrases).
 * The canonical id list is published in docs/onboarding-contract.md and MUST
 * stay in sync with the portal's amenity picker.
 */
import { AMENITY_IDS } from './amenity-catalog';
export { AMENITY_IDS } from './amenity-catalog';

export type AmenityId = (typeof AMENITY_IDS)[number];

/**
 * Amenity ids that trigger the pool-safety requirement. Informational unless
 * already enforced elsewhere - kept id-based for a stable contract.
 */
export const REQUIRES_POOL_SAFETY: AmenityId[] = ['pool'];

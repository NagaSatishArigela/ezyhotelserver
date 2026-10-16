/**
 * Amenity vocabulary for EzyHotels onboarding, including the PDF additions.
 *
 * Amenities are ID-BASED: Step 3 `amenities: string[]` carries these stable
 * ids, and the compliance gates below match on ids (not display phrases).
 * The canonical id list is published in docs/onboarding-contract.md and MUST
 * stay in sync with the portal's amenity picker.
 */
import { AMENITY_IDS } from './amenity-catalog';
import { amenityVariants } from './amenity-catalog';
export { AMENITY_IDS } from './amenity-catalog';

export type AmenityId = (typeof AMENITY_IDS)[number];

/**
 * Amenity ids that trigger the pool-safety requirement. Informational unless
 * already enforced elsewhere - kept id-based for a stable contract.
 */
export const REQUIRES_POOL_SAFETY: AmenityId[] = ['pool'];


// Historical listings store display labels; new onboarding stores stable IDs.
const AMENITY_ALIASES: Record<string, string[]> = {
  wifi: ['wifi', 'wi-fi'], ac: ['ac', 'air conditioning'], parking: ['parking'],
  pool: ['pool', 'swimming pool'], gym: ['gym', 'gym / fitness', 'gym/fitness'],
  restaurant: ['restaurant'], bar: ['bar', 'bar / lounge'], spa: ['spa'],
  reception_24: ['reception_24', '24hr reception'], room_service: ['room_service', 'room service'],
  laundry: ['laundry'], conference: ['conference', 'conference room'], rooftop: ['rooftop', 'rooftop access'],
  couples: ['couples', 'couples allowed', 'couples welcome'], pets: ['pets', 'pets allowed'],
  wheelchair: ['wheelchair', 'wheelchair access'], cctv: ['cctv', 'cctv security'],
  ev_charging: ['ev_charging', 'ev charging'],
};

export function amenityAliases(value: string): string[] {
  const normalized = value.trim().toLowerCase();
  const legacy = Object.values(AMENITY_ALIASES).find((aliases) => aliases.includes(normalized)) ?? [];
  return [...new Set([...legacy, ...amenityVariants(value).map(alias => alias.toLowerCase()), normalized])];
}

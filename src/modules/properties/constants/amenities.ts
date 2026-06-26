/**
 * Mirrors REQUIRES_FSSAI / REQUIRES_POOL_SAFETY in
 * payperhour-next/modules/owner/amenities.ts. Used at submission time (M1
 * spec edge case 6) to determine which compliance documents are mandatory
 * based on the amenities selected in step 3.
 */
export const REQUIRES_FSSAI = [
  'Restaurant on Premises → FSSAI required',
  'In-house Catering → FSSAI required',
  'Bar / Lounge → Liquor License',
  'Restaurant → FSSAI required',
  'Meals Provided → FSSAI if commercial',
  'Meals Provided → FSSAI (if > 5 persons)',
];

export const REQUIRES_POOL_SAFETY = [
  'Swimming Pool',
  'Kids Pool',
  'Private Pool',
  'Pool / Kids Pool → Pool Safety Cert',
  'Pool → Pool Safety Cert',
];

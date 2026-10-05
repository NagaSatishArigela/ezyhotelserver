/**
 * Amenities - Google Docs.pdf, amenities sections, 2026-10-01.
 * This portable catalogue is mirrored in portal, server and web repositories.
 * Keep all three copies identical when changing the API vocabulary.
 * Separate PDF requests (property subtypes, activities, KYC and bank fields)
 * are outside this amenity catalogue.
 */
export interface AmenityDefinition {
  id: string;
  label: string;
  propertyTypes: readonly string[];
  aliases: readonly string[];
  retired?: boolean;
}

export const AMENITY_CATALOG: readonly AmenityDefinition[] = [
  { id: "wifi", label: "Wi-Fi", propertyTypes: ["*"], aliases: ["WiFi"] },
  { id: "ac", label: "Air conditioning", propertyTypes: ["*"], aliases: ["AC"] },
  { id: "parking", label: "Parking", propertyTypes: ["*"], aliases: [] },
  { id: "pool", label: "Swimming pool", propertyTypes: ["*"], aliases: ["Pool"] },
  { id: "gym", label: "Gym / Fitness", propertyTypes: ["*"], aliases: ["Gym"] },
  { id: "restaurant", label: "Restaurant", propertyTypes: ["*"], aliases: [] },
  { id: "bar", label: "Bar / Lounge", propertyTypes: ["*"], aliases: ["Bar"] },
  { id: "spa", label: "Spa", propertyTypes: ["*"], aliases: [] },
  { id: "reception_24", label: "24hr Reception", propertyTypes: ["*"], aliases: [] },
  { id: "room_service", label: "Room service", propertyTypes: ["*"], aliases: [] },
  { id: "laundry", label: "Laundry", propertyTypes: ["*"], aliases: [] },
  { id: "conference", label: "Conference room", propertyTypes: ["*"], aliases: ["Business Center"] },
  { id: "couples", label: "Couples welcome", propertyTypes: ["*"], aliases: ["Couples Allowed"] },
  { id: "pets", label: "Pets allowed", propertyTypes: ["*"], aliases: ["Pet Friendly"] },
  { id: "wheelchair", label: "Wheelchair access", propertyTypes: ["*"], aliases: [] },
  { id: "cctv", label: "CCTV security", propertyTypes: ["*"], aliases: ["CCTV"] },
  { id: "ev_charging", label: "EV charging", propertyTypes: ["*"], aliases: [] },
  { id: "power_backup", label: "Power backup", propertyTypes: ["hotel","banquet"], aliases: [] },
  { id: "travel_desk", label: "Travel desk service", propertyTypes: ["hotel"], aliases: [] },
  { id: "tv", label: "TV", propertyTypes: ["hotel"], aliases: [] },
  { id: "geyser", label: "Geyser", propertyTypes: ["hotel"], aliases: [] },
  { id: "balcony", label: "Balcony", propertyTypes: ["hotel"], aliases: [] },
  { id: "group_parties", label: "Group parties allowed", propertyTypes: ["hotel"], aliases: [] },
  { id: "doctor_on_call", label: "Doctor on call", propertyTypes: ["hotel"], aliases: [] },
  { id: "first_aid", label: "First aid", propertyTypes: ["hotel","banquet"], aliases: [] },
  { id: "kitchen", label: "Kitchen", propertyTypes: ["homestay","villa"], aliases: [] },
  { id: "living_room", label: "Living room", propertyTypes: ["homestay","villa"], aliases: [] },
  { id: "dining_area", label: "Dining area / room", propertyTypes: ["homestay","villa"], aliases: ["Dining Area","Dining Room"] },
  { id: "garden", label: "Garden", propertyTypes: ["villa"], aliases: [] },
  { id: "children_area", label: "Children's area", propertyTypes: ["villa"], aliases: [] },
  { id: "outdoor_games", label: "Outdoor games", propertyTypes: ["villa"], aliases: [] },
  { id: "indoor_games", label: "Indoor games", propertyTypes: ["villa"], aliases: [] },
  { id: "music_system", label: "Music system", propertyTypes: ["villa","farm"], aliases: [] },
  { id: "mattress", label: "Mattress", propertyTypes: ["pg"], aliases: [] },
  { id: "bed", label: "Bed", propertyTypes: ["pg"], aliases: [] },
  { id: "cupboard", label: "Cupboard", propertyTypes: ["pg"], aliases: [] },
  { id: "study_chair", label: "Study chair", propertyTypes: ["pg"], aliases: [] },
  { id: "washing_machine", label: "Washing machine", propertyTypes: ["pg"], aliases: [] },
  { id: "housekeeping", label: "Housekeeping", propertyTypes: ["pg"], aliases: [] },
  { id: "security", label: "Security", propertyTypes: ["pg","farm"], aliases: [] },
  { id: "warden", label: "Warden", propertyTypes: ["pg"], aliases: [] },
  { id: "campfire", label: "Campfire", propertyTypes: ["farm"], aliases: [] },
  { id: "swimming_well", label: "Well for swimming", propertyTypes: ["farm"], aliases: ["Well for Swimm"] },
  { id: "rain_dance", label: "Rain dance", propertyTypes: ["farm"], aliases: [] },
  { id: "tree_swing", label: "Tree swing", propertyTypes: ["farm"], aliases: ["Tree Swingzy"] },
  { id: "fans", label: "Fans", propertyTypes: ["banquet"], aliases: [] },
  { id: "lighting", label: "Lighting", propertyTypes: ["banquet"], aliases: [] },
  { id: "decorative_lighting", label: "Decorative lighting", propertyTypes: ["banquet"], aliases: [] },
  { id: "stage", label: "Stage", propertyTypes: ["banquet"], aliases: [] },
  { id: "led_screen", label: "LED screen", propertyTypes: ["banquet"], aliases: [] },
  { id: "projector", label: "Projector", propertyTypes: ["banquet"], aliases: [] },
  { id: "sound_system", label: "Sound system", propertyTypes: ["banquet"], aliases: [] },
  { id: "microphones", label: "Microphones", propertyTypes: ["banquet"], aliases: [] },
  { id: "dj_facility", label: "DJ facility", propertyTypes: ["banquet"], aliases: [] },
  { id: "dance_floor", label: "Dance floor", propertyTypes: ["banquet"], aliases: [] },
  { id: "generator_backup", label: "Generator backup", propertyTypes: ["banquet"], aliases: [] },
  { id: "charging_points", label: "Charging points", propertyTypes: ["banquet"], aliases: [] },
  { id: "fire_safety_equipment", label: "Fire safety equipment", propertyTypes: ["banquet"], aliases: [] },
  { id: "emergency_exit", label: "Emergency exit", propertyTypes: ["banquet"], aliases: [] },
  { id: "rooftop", label: "Rooftop access", propertyTypes: [], aliases: ["Rooftop Accesses"], retired: true },
];

export const AMENITY_IDS = AMENITY_CATALOG.map(amenity => amenity.id);

const byId = new Map(AMENITY_CATALOG.map(amenity => [amenity.id, amenity]));
const aliases = new Map(AMENITY_CATALOG.flatMap(amenity =>
  [amenity.id, amenity.label, ...amenity.aliases].map(value => [value.toLowerCase(), amenity.id] as const),
));

/** Preserve unknown historical values when reading, while normalizing known aliases. */
export function normalizeAmenity(value: string): string {
  return aliases.get(value.trim().toLowerCase()) ?? value.trim();
}

export function amenityLabel(value: string): string {
  return byId.get(normalizeAmenity(value))?.label ?? value.replace(/_/g, ' ');
}

export function amenitiesForProperty(propertyType: string): AmenityDefinition[] {
  return AMENITY_CATALOG.filter(amenity => !amenity.retired &&
    (propertyType === 'other' || amenity.propertyTypes.includes('*') || amenity.propertyTypes.includes(propertyType)));
}

/** Exact variants for searching historical label-based rows and canonical ID rows. */
export function amenityVariants(value: string): string[] {
  const amenity = byId.get(normalizeAmenity(value));
  return amenity ? [...new Set([amenity.id, amenity.label, ...amenity.aliases, value])] : [value];
}


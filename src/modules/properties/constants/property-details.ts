// Source: Amenities - Google Docs.pdf. Keep the three app copies in sync.
export type DetailValue = string | number | boolean | string[]
export type PropertyDetails = Record<string, DetailValue>
export interface DetailField {
  id: string; label: string; kind: 'select' | 'multi' | 'boolean' | 'number' | 'text' | 'time'
  options?: readonly string[]
}
export interface DetailGroup { propertyType: string; title: string; fields: readonly DetailField[] }
export const PROPERTY_TYPE_OPTIONS = [
  { value: 'hotel', label: 'Hotel' },
  { value: 'resort', label: 'Resort' },
  { value: 'villa', label: 'Villa' },
  { value: 'guest_house', label: 'Guest House' },
  { value: 'farm', label: 'Farm House' },
  { value: 'homestay', label: 'Homestay' },
  { value: 'pg', label: 'PG' },
  { value: 'lodge', label: 'Lodge' },
  { value: 'dormitory', label: 'Dormitory' },
  { value: 'banquet', label: 'Banquet/Convention Hall' },
  { value: 'other', label: 'Other' },
] as const
export const PROPERTY_DETAIL_GROUPS: readonly DetailGroup[] = [
  {"propertyType":"resort","title":"Resort details","fields":[{"id":"resortType","label":"Type of resort","kind":"select","options":["Beach Resort","Hill Resort","Forest Resort","Family Resort","Luxury Resort","Adventure Resort","Farm Resort / Garden Resort","Wellness Resort","Other Resort","River view"]},{"id":"resortActivities","label":"Resort activities","kind":"multi","options":["Boating","Trekking","Cycling","Rain Dance","Adventure Activities","Campfire","Fishing","Nature Walk","Indoor Games","Outdoor Games","Swimming Pool"]}]},
  {"propertyType":"homestay","title":"Homestay details","fields":[{"id":"homestayType","label":"Type of homestay","kind":"select","options":["Entire Home","Private Room","Shared Room","Apartment Rooms","Cottage","Independent Room","Pent house","Other"]},{"id":"food","label":"Food","kind":"multi","options":["Breakfast","Lunch","Dinner","Homemade Food","Vegetarian","Non-Vegetarian"]}]},
  {"propertyType":"homestay","title":"Host information","fields":[{"id":"hostLivesOnProperty","label":"Host lives on property?","kind":"boolean"},{"id":"hostAvailable","label":"Host available?","kind":"boolean"},{"id":"caretakerAvailable","label":"Caretaker available?","kind":"boolean"}]},
  {"propertyType":"villa","title":"Villa details","fields":[{"id":"villaType","label":"Type of villa","kind":"select","options":["Luxury Villa","Private Villa","Family Villa","Beach Villa","Pool Villa","Holiday Villa","Farm Villa","Bachelor villa","Other"]}]},
  {"propertyType":"pg","title":"PG details","fields":[{"id":"pgAllowedType","label":"PG allowed type","kind":"select","options":["Boys","Girls","Co-Living","Working Professionals","Students","Other"]},{"id":"pgOccupancyType","label":"PG occupancy type","kind":"select","options":["Single sharing room","Double sharing","Triple sharing","Four Sharing","Dormitory"]}]},
  {"propertyType":"pg","title":"Rules / policies","fields":[{"id":"minimumStay","label":"Minimum stay (days)","kind":"number"},{"id":"maximumStay","label":"Maximum stay (days)","kind":"number"},{"id":"curfew","label":"Curfew","kind":"time"},{"id":"visitorPolicy","label":"Visitor policy","kind":"text"},{"id":"smokingPolicy","label":"Smoking policy","kind":"text"},{"id":"alcoholPolicy","label":"Alcohol policy","kind":"text"}]},
  {"propertyType":"farm","title":"Farm house details","fields":[{"id":"totalLandArea","label":"Total land area","kind":"number"},{"id":"landAreaUnit","label":"Land area unit","kind":"select","options":["Sft","Acre"]},{"id":"dryLand","label":"Dry land area","kind":"number"},{"id":"wetLand","label":"Wet land area","kind":"number"},{"id":"greenLand","label":"Green land area","kind":"number"},{"id":"bedrooms","label":"Bedrooms","kind":"number"},{"id":"bathrooms","label":"Bathrooms","kind":"number"}]},
  {"propertyType":"farm","title":"Allowed activities","fields":[{"id":"farmActivities","label":"Allowed activities","kind":"multi","options":["Day Outing","Family Gathering","Birthday Party","Corporate Event","Wedding / Function","Camping","Farm Activities","Outdoor Games","DJ / Music"]}]},
  {"propertyType":"banquet","title":"Event type","fields":[{"id":"eventType","label":"Event type","kind":"select","options":["Marriage Hall","Function Hall","Convention Hall","Conference Hall","Party Hall","Community Hall","Corporate Hall","Other"]}]},
  {"propertyType":"banquet","title":"Capacity","fields":[{"id":"minimumGuests","label":"Minimum guests","kind":"number"},{"id":"maximumGuests","label":"Maximum guests","kind":"number"},{"id":"seatingCapacity","label":"Seating capacity","kind":"number"},{"id":"floatingCapacity","label":"Floating capacity","kind":"number"},{"id":"diningCapacity","label":"Dining capacity","kind":"number"},{"id":"theatreStyle","label":"Theatre style","kind":"number"},{"id":"classroomStyle","label":"Classroom style","kind":"number"},{"id":"clusterSeating","label":"Cluster seating","kind":"number"}]},
  {"propertyType":"banquet","title":"Seating & furniture","fields":[{"id":"furniture","label":"Seating & furniture","kind":"multi","options":["Chairs","Tables","Round Tables","Dining Tables","Sofa Seating","VIP Seating","Stage Chairs","Reception Desk","Podium","Whiteboard","Conference Table"]}]},
  {"propertyType":"banquet","title":"Catering","fields":[{"id":"catering","label":"Catering","kind":"multi","options":["In-house Catering","Outside Catering Allowed","Vegetarian","Non-Vegetarian","Buffet","Plate System available"]}]},
  {"propertyType":"banquet","title":"Decoration","fields":[{"id":"decoration","label":"Decoration","kind":"multi","options":["Basic Decoration","Wedding Decoration","Stage Decoration","Floral Decoration","Balloon Decoration","Birthday Decoration","Reception Decoration","Lighting Decoration"]}]},
  {"propertyType":"banquet","title":"Parking","fields":[{"id":"parkingAvailable","label":"Parking available?","kind":"boolean"},{"id":"twoWheelerParking","label":"Two-wheeler parking?","kind":"boolean"},{"id":"carParking","label":"Car parking?","kind":"boolean"},{"id":"busParking","label":"Bus parking?","kind":"boolean"},{"id":"approximateCarCapacity","label":"Approximate car capacity available?","kind":"boolean"},{"id":"valetParking","label":"Valet parking?","kind":"boolean"},{"id":"parkingCharge","label":"Parking charge","kind":"select","options":["Free","Paid"]},{"id":"dedicatedParking","label":"Dedicated parking?","kind":"boolean"}]},
  {"propertyType":"banquet","title":"Guest rooms / changing rooms","fields":[{"id":"guestRooms","label":"Guest rooms / changing rooms","kind":"multi","options":["Bridal Room","Groom Room","Changing Room","Guest Rooms","Attached Bathroom","VIP Room","Waiting Room"]}]},
  {"propertyType":"banquet","title":"Other facilities","fields":[{"id":"otherFacilities","label":"Other facilities","kind":"multi","options":["Male Washroom","Female Washroom","Accessible / Disabled Washroom","Attached Washrooms","Baby Changing Facility","Washroom Attendant","Wheelchair Accessible Entrance","Wheelchair Ramp","Lift","Accessible Washroom","Ground-Floor Hall","Wheelchair Parking","Elderly-Friendly Access"]},{"id":"washroomCount","label":"Number of washrooms","kind":"number"}]}
]
export function detailGroups(propertyType: string): readonly DetailGroup[] {
  return PROPERTY_DETAIL_GROUPS.filter(group => group.propertyType === propertyType)
}
export function requiredBookingPolicy(propertyType: string): 'fullday' | 'hourly' | undefined {
  return propertyType === 'pg' ? 'fullday' : propertyType === 'banquet' ? 'hourly' : undefined
}
export function propertyDetailsErrors(propertyType: string, value: unknown): string[] {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return ['Invalid property details']
  const fields = detailGroups(propertyType).flatMap(group => [...group.fields])
  const data = value as Record<string, unknown>
  const errors: string[] = []
  for (const [id, item] of Object.entries(data)) {
    const field = fields.find(candidate => candidate.id === id)
    if (!field) { errors.push('Unsupported property detail: ' + id); continue }
    let valid = false
    switch (field.kind) {
      case 'select': valid = typeof item === 'string' && !!field.options?.includes(item); break
      case 'multi': valid = Array.isArray(item) && item.length <= (field.options?.length ?? 0) && new Set(item).size === item.length && item.every(option => typeof option === 'string' && field.options?.includes(option)); break
      case 'boolean': valid = typeof item === 'boolean'; break
      case 'number': valid = typeof item === 'number' && Number.isFinite(item) && item >= 0 && item <= 100000000 && (['totalLandArea', 'dryLand', 'wetLand', 'greenLand'].includes(id) || Number.isInteger(item)); break
      case 'time': valid = typeof item === 'string' && /^([01][0-9]|2[0-3]):[0-5][0-9]$/.test(item); break
      case 'text': valid = typeof item === 'string' && item.length <= 500 && !/[<>]/.test(item); break
    }
    if (!valid) errors.push('Check ' + field.label.toLowerCase())
  }
  for (const [minimum, maximum] of [['minimumStay', 'maximumStay'], ['minimumGuests', 'maximumGuests']]) {
    if (typeof data[minimum] === 'number' && typeof data[maximum] === 'number' && (data[minimum] as number) > (data[maximum] as number)) errors.push('Minimum cannot exceed maximum')
  }
  return errors
}


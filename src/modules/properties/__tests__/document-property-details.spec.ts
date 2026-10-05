import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { Step1BasicsDto } from '../dto/step1-basics.dto';
import { Step3RoomsPoliciesDto } from '../dto/step3-rooms-policies.dto';
import { Step5LegalDto } from '../dto/step5-legal.dto';
import { AMENITY_IDS, amenityVariants } from '../constants/amenity-catalog';

const basics = { propertyName: 'Demo Stay', propertyType: 'hotel', bookingPolicy: 'both',
  businessEntity: 'individual', ownerFirstName: 'Owner', category: 'budget' };
const errors = (value: object) => validate(value, { whitelist: true, forbidNonWhitelisted: true });

describe('PDF property contract', () => {
  it.each([
    ['resort', { resortType: 'Beach Resort', resortActivities: ['Boating', 'Nature Walk'] }],
    ['homestay', { homestayType: 'Entire Home', food: ['Homemade Food'], hostAvailable: false }],
    ['villa', { villaType: 'Pool Villa' }],
    ['pg', { pgAllowedType: 'Girls', pgOccupancyType: 'Double sharing', curfew: '22:00', minimumStay: 1, maximumStay: 30 }],
    ['farm', { totalLandArea: 1.5, landAreaUnit: 'Acre', farmActivities: ['Camping'] }],
    ['banquet', { eventType: 'Conference Hall', furniture: ['Conference Table'], catering: ['Buffet'], decoration: ['Floral Decoration'], parkingCharge: 'Free', valetParking: false, guestRooms: ['VIP Room'], otherFacilities: ['Lift'], washroomCount: 4 }],
  ])('accepts %s fields without stripping them', async (propertyType, propertyDetails) => {
    const dto = plainToInstance(Step1BasicsDto, { ...basics, propertyType, propertyDetails,
      bookingPolicy: propertyType === 'pg' ? 'fullday' : propertyType === 'banquet' ? 'hourly' : 'both' });
    expect(await errors(dto)).toEqual([]);
    expect(dto.propertyDetails).toEqual(propertyDetails);
  });

  it.each([
    ['pg', 'hourly', {}], ['pg', 'both', {}], ['banquet', 'fullday', {}],
    ['hotel', 'both', { secret: 'unknown' }], ['villa', 'both', { villaType: 'Beach Resort' }],
    ['pg', 'fullday', { minimumStay: 20, maximumStay: 10 }],
    ['homestay', 'both', { hostAvailable: 'yes' }],
    ['banquet', 'hourly', { washroomCount: -1 }],
  ])('rejects inconsistent %s details/policy %s', async (propertyType, bookingPolicy, propertyDetails) => {
    expect((await errors(plainToInstance(Step1BasicsDto, { ...basics, propertyType, bookingPolicy, propertyDetails })))).not.toHaveLength(0);
  });

  it('normalizes old amenities and accepts every new canonical amenity', async () => {
    const dto = plainToInstance(Step3RoomsPoliciesDto, { amenities: ['WiFi', 'wifi', ...AMENITY_IDS] });
    const result = await errors(dto);
    expect(result.filter(error => error.property === 'amenities')).toEqual([]);
    expect(dto.amenities.filter(value => value === 'wifi')).toHaveLength(1);
    expect(amenityVariants('wifi')).toEqual(expect.arrayContaining(['wifi', 'WiFi', 'Wi-Fi']));
    const invalid = await errors(plainToInstance(Step3RoomsPoliciesDto, { amenities: ['not-a-real-amenity'] }));
    expect(invalid.some(error => error.property === 'amenities')).toBe(true);
  });

  it.each(['cash_credit', 'other'])('accepts %s and the new private document types', async accountType => {
    const dto = plainToInstance(Step5LegalDto, { accountType, documents: [
      { type: 'id_proof_back', url: 'https://files.test/id-back.png' },
      { type: 'udyam_certificate', url: 'https://files.test/udyam.pdf' },
      { type: 'owner_photo', url: 'https://files.test/owner.png' },
    ] });
    expect((await errors(dto)).filter(error => ['accountType', 'documents'].includes(error.property))).toEqual([]);
  });
});

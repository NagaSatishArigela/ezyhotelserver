import { validateStepPayload } from '../utils/validate-step';
import { OtherAccommodationDto, DormitoryDetailsDto } from '../dto/accommodation.dto';
import { Step1BasicsDto } from '../dto/step1-basics.dto';
import { RoomTypeWizardDto } from '../dto/step3-rooms-policies.dto';

const facilities = Object.fromEntries([
  'windows', 'bathroom', 'roofInstallation', 'rainWaterProtection', 'sunRoof',
  'electricity', 'familiesAllowed', 'groupPartiesAllowed', 'soloAccommodationAllowed',
  'childrenBeds', 'hotWater', 'accommodationService', 'lockDoor', 'privacyProtection',
  'pillowBlanket', 'luggageStorage', 'housekeeping', 'chargingSockets',
].map((key) => [key, 'no']));

const dormitory = {
  roomName: 'D-101', totalBeds: 24, bedLength: 200, bedWidth: 90,
  accommodationAllowedFor: 'Mixed-gender dormitory', category: 'Bunk-bed room',
  bedType: 'Single bunk', bedAllocation: 'Any available bed',
  sleepingArrangement: 'Shared room', attachedBathroom: 'No', bathroomType: 'Common',
  lockerAvailability: 'Individual locker', mattressType: 'Standard',
  chargingPoint: 'Each bed', readingLight: 'Shared', privacyScreen: 'Yes',
  linenProvided: ['Bedsheet', 'Pillow'],
};

describe('Accommodation validation', () => {
  it.each(['container_home', 'tents_glamping', 'tree_house'])('accepts all facilities with negative answers for %s', async (type) => {
    const payload = { type, numberOfBeds: 2, ...facilities };
    await expect(validateStepPayload(1, OtherAccommodationDto, payload)).resolves.toEqual(payload);
  });

  it('rejects an incomplete Others specification with the field name', async () => {
    await expect(validateStepPayload(1, OtherAccommodationDto, { type: 'container_home' })).rejects.toMatchObject({
      response: { errors: expect.arrayContaining([expect.objectContaining({ field: 'numberOfBeds' })]) },
    });
  });

  it('accepts legacy Others properties without the new optional details', async () => {
    const basics = { propertyName: 'Test property', propertyType: 'other', bookingPolicy: 'hourly', businessEntity: 'individual', ownerFirstName: 'Ravi', ownerLastName: 'Kumar', category: 'mid' };
    await expect(validateStepPayload(1, Step1BasicsDto, basics)).resolves.toMatchObject(basics);
    await expect(validateStepPayload(1, Step1BasicsDto, { ...basics, otherAccommodation: {} })).rejects.toThrow();
  });

  it('accepts dormitory details and capacity over 20', async () => {
    const room = { type: 'dorm', count: 1, maxOccupancy: 24, dormitory };
    await expect(validateStepPayload(3, RoomTypeWizardDto, room)).resolves.toEqual(room);
  });

  it('rejects unsupported dormitory options and negative bed counts', async () => {
    await expect(validateStepPayload(3, DormitoryDetailsDto, { ...dormitory, totalBeds: -1, bedType: 'King' })).rejects.toMatchObject({
      response: { errors: expect.arrayContaining([
        expect.objectContaining({ field: 'totalBeds' }), expect.objectContaining({ field: 'bedType' }),
      ]) },
    });
  });

  it('accepts legacy dorm rooms without additional specifications', async () => {
    const room = { type: 'dorm', count: 1 };
    await expect(validateStepPayload(3, RoomTypeWizardDto, room)).resolves.toEqual(room);
    await expect(validateStepPayload(3, RoomTypeWizardDto, { ...room, dormitory: {} })).rejects.toThrow();
  });
});

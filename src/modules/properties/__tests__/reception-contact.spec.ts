import { validateStepPayload } from '../utils/validate-step';
import { Step1BasicsDto } from '../dto/step1-basics.dto';
import { UpdateOwnerSettingsDto } from '../dto/owner-settings.dto';

const basics = { propertyName: 'Test property', propertyType: 'hotel', bookingPolicy: 'hourly', businessEntity: 'individual', ownerFirstName: 'Ravi', ownerLastName: 'Kumar', category: 'mid' };

describe('Reception contact validation', () => {
  it('normalizes contact numbers and accepts the optional empty landline', async () => {
    await expect(validateStepPayload(1, Step1BasicsDto, { ...basics, receptionMobile: '+91 98765-43210', receptionLandline: '(080) 2345-6789' })).resolves.toMatchObject({ receptionMobile: '9876543210', receptionLandline: '08023456789' });
    await expect(validateStepPayload(1, Step1BasicsDto, { ...basics, receptionMobile: '9876543210', receptionLandline: '' })).resolves.toMatchObject({ receptionLandline: null });
  });

  it.each(['', '1234567890', '987654321x', null])('rejects invalid mobile updates: %j', async (receptionMobile) => {
    await expect(validateStepPayload(1, UpdateOwnerSettingsDto, { receptionMobile })).rejects.toThrow();
  });

  it('keeps old operational settings updates valid and supports clearing only the landline', async () => {
    await expect(validateStepPayload(1, UpdateOwnerSettingsDto, { isActive: false })).resolves.toEqual({ isActive: false });
    await expect(validateStepPayload(1, UpdateOwnerSettingsDto, { receptionLandline: '' })).resolves.toEqual({ receptionLandline: null });
    await expect(validateStepPayload(1, UpdateOwnerSettingsDto, { receptionLandline: 0 })).rejects.toThrow();
  });
});

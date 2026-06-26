import { Step1BasicsDto } from './step1-basics.dto';
import { Step2LocationDto } from './step2-location.dto';
import { Step3RoomsPoliciesDto } from './step3-rooms-policies.dto';
import { Step4PhotosDto } from './step4-photos.dto';

/**
 * Maps wizard step numbers (1-4) to their validation DTO. Step 5
 * (legal/compliance) is handled separately by ComplianceService since it
 * writes directly to the `compliance` schema instead of `draftData`.
 */
export const STEP_DTO_MAP: Record<1 | 2 | 3 | 4, new () => object> = {
  1: Step1BasicsDto,
  2: Step2LocationDto,
  3: Step3RoomsPoliciesDto,
  4: Step4PhotosDto,
};

export const MIN_STEP = 1;
export const MAX_STEP = 5;

export {
  Step1BasicsDto,
  Step2LocationDto,
  Step3RoomsPoliciesDto,
  Step4PhotosDto,
};
export * from './step3-rooms-policies.dto';
export * from './step4-photos.dto';

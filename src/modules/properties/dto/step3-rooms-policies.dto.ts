import { ApiProperty } from '@nestjs/swagger';
import { RoomTypeCategory } from '@prisma/client';
import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsEnum,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';

const MIN_BOOKING_HOURS_VALUES = ['1', '2', '3'] as const;
const YES_NO_ON_REQUEST = ['yes', 'no', 'on_request'] as const;
const ALCOHOL_ALLOWED_VALUES = ['yes', 'no', 'not_allowed'] as const;
const SMOKING_ALLOWED_VALUES = ['yes', 'no', 'designated_area'] as const;
const YES_NO = ['yes', 'no'] as const;

/**
 * Mirrors `roomTypeSchema` in payperhour-next/modules/owner/schemas/index.ts.
 * hourlyRate/fulldayRate are in rupees here; converted to *Paise integers
 * when materialized into RoomType rows on submit (M1 spec edge case 13).
 */
export class RoomTypeWizardDto {
  @ApiProperty({ enum: RoomTypeCategory })
  @IsEnum(RoomTypeCategory)
  type: RoomTypeCategory;

  @ApiProperty()
  @IsInt()
  @Min(0)
  @Max(500)
  count: number;

  @ApiProperty({ required: false })
  @IsOptional()
  @Min(100)
  @Max(100000)
  hourlyRate?: number;

  @ApiProperty({ required: false })
  @IsOptional()
  @Min(500)
  @Max(500000)
  fulldayRate?: number;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(20)
  maxOccupancy?: number;
}

/**
 * Mirrors `step3cSchema` (house rules) in
 * payperhour-next/modules/owner/schemas/index.ts.
 */
export class HouseRulesDto {
  @ApiProperty({ enum: YES_NO_ON_REQUEST })
  @IsIn(YES_NO_ON_REQUEST)
  couple_friendly: (typeof YES_NO_ON_REQUEST)[number];

  @ApiProperty({ enum: YES_NO_ON_REQUEST })
  @IsIn(YES_NO_ON_REQUEST)
  pet_friendly: (typeof YES_NO_ON_REQUEST)[number];

  @ApiProperty({ enum: YES_NO_ON_REQUEST })
  @IsIn(YES_NO_ON_REQUEST)
  party_allowed: (typeof YES_NO_ON_REQUEST)[number];

  @ApiProperty({ enum: ALCOHOL_ALLOWED_VALUES })
  @IsIn(ALCOHOL_ALLOWED_VALUES)
  alcohol_allowed: (typeof ALCOHOL_ALLOWED_VALUES)[number];

  @ApiProperty({ enum: SMOKING_ALLOWED_VALUES })
  @IsIn(SMOKING_ALLOWED_VALUES)
  smoking_allowed: (typeof SMOKING_ALLOWED_VALUES)[number];

  @ApiProperty({ enum: YES_NO })
  @IsIn(YES_NO)
  bachelor_groups: (typeof YES_NO)[number];

  @ApiProperty({ enum: YES_NO })
  @IsIn(YES_NO)
  id_proof_required: (typeof YES_NO)[number];

  @ApiProperty({ enum: YES_NO_ON_REQUEST })
  @IsIn(YES_NO_ON_REQUEST)
  outside_food: (typeof YES_NO_ON_REQUEST)[number];

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  noiseCutoffTime?: string;

  @ApiProperty({ required: false, maxLength: 200 })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  alcoholPolicyNote?: string;
}

/**
 * Step 3 - combines `step3Schema` (rooms & policies), `step3bSchema`
 * (amenities) and `step3cSchema` (house rules) from
 * payperhour-next/modules/owner/schemas/index.ts into a single wizard step.
 */
export class Step3RoomsPoliciesDto {
  @ApiProperty({ type: [RoomTypeWizardDto] })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => RoomTypeWizardDto)
  rooms: RoomTypeWizardDto[];

  @ApiProperty({ required: false, enum: MIN_BOOKING_HOURS_VALUES })
  @IsOptional()
  @IsIn(MIN_BOOKING_HOURS_VALUES)
  minBookingHours?: (typeof MIN_BOOKING_HOURS_VALUES)[number];

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  defaultCheckinTime?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  defaultCheckoutTime?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsInt()
  @Min(50)
  @Max(5000)
  seatingCapacity?: number;

  @ApiProperty({ type: [String] })
  @IsArray()
  @ArrayMinSize(1, { message: 'Select at least one amenity' })
  @IsString({ each: true })
  amenities: string[];

  @ApiProperty({ type: HouseRulesDto })
  @ValidateNested()
  @Type(() => HouseRulesDto)
  houseRules: HouseRulesDto;
}

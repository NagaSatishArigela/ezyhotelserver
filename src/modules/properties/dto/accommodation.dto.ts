import { ApiProperty } from '@nestjs/swagger';
import { IsArray, IsIn, IsInt, IsNumber, IsString, Max, MaxLength, Min, MinLength } from 'class-validator';

export class OtherAccommodationDto {
  @ApiProperty({ enum: ['container_home', 'tents_glamping', 'tree_house'] })
  @IsIn(['container_home', 'tents_glamping', 'tree_house'])
  type: 'container_home' | 'tents_glamping' | 'tree_house';

  @ApiProperty()
  @IsInt()
  @Min(1)
  @Max(500)
  numberOfBeds: number;

  @ApiProperty({ enum: ['yes', 'no'] })
  @IsIn(['yes', 'no'])
  windows: 'yes' | 'no';

  @ApiProperty({ enum: ['yes', 'no'] })
  @IsIn(['yes', 'no'])
  bathroom: 'yes' | 'no';

  @ApiProperty({ enum: ['yes', 'no'] })
  @IsIn(['yes', 'no'])
  roofInstallation: 'yes' | 'no';

  @ApiProperty({ enum: ['yes', 'no'] })
  @IsIn(['yes', 'no'])
  rainWaterProtection: 'yes' | 'no';

  @ApiProperty({ enum: ['yes', 'no'] })
  @IsIn(['yes', 'no'])
  sunRoof: 'yes' | 'no';

  @ApiProperty({ enum: ['yes', 'no'] })
  @IsIn(['yes', 'no'])
  electricity: 'yes' | 'no';

  @ApiProperty({ enum: ['yes', 'no'] })
  @IsIn(['yes', 'no'])
  familiesAllowed: 'yes' | 'no';

  @ApiProperty({ enum: ['yes', 'no'] })
  @IsIn(['yes', 'no'])
  groupPartiesAllowed: 'yes' | 'no';

  @ApiProperty({ enum: ['yes', 'no'] })
  @IsIn(['yes', 'no'])
  soloAccommodationAllowed: 'yes' | 'no';

  @ApiProperty({ enum: ['yes', 'no'] })
  @IsIn(['yes', 'no'])
  childrenBeds: 'yes' | 'no';

  @ApiProperty({ enum: ['yes', 'no'] })
  @IsIn(['yes', 'no'])
  hotWater: 'yes' | 'no';

  @ApiProperty({ enum: ['yes', 'no'] })
  @IsIn(['yes', 'no'])
  accommodationService: 'yes' | 'no';

  @ApiProperty({ enum: ['yes', 'no'] })
  @IsIn(['yes', 'no'])
  lockDoor: 'yes' | 'no';

  @ApiProperty({ enum: ['yes', 'no'] })
  @IsIn(['yes', 'no'])
  privacyProtection: 'yes' | 'no';

  @ApiProperty({ enum: ['yes', 'no'] })
  @IsIn(['yes', 'no'])
  pillowBlanket: 'yes' | 'no';

  @ApiProperty({ enum: ['yes', 'no'] })
  @IsIn(['yes', 'no'])
  luggageStorage: 'yes' | 'no';

  @ApiProperty({ enum: ['yes', 'no'] })
  @IsIn(['yes', 'no'])
  housekeeping: 'yes' | 'no';

  @ApiProperty({ enum: ['yes', 'no'] })
  @IsIn(['yes', 'no'])
  chargingSockets: 'yes' | 'no';
}

export class DormitoryDetailsDto {
  @ApiProperty()
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  roomName: string;

  @ApiProperty()
  @IsInt()
  @Min(1)
  @Max(500)
  totalBeds: number;

  @ApiProperty()
  @IsNumber()
  @Min(0.1)
  @Max(500)
  bedLength: number;

  @ApiProperty()
  @IsNumber()
  @Min(0.1)
  @Max(500)
  bedWidth: number;

  @ApiProperty({ enum: ['Male dormitory', 'Female dormitory', 'Mixed-gender dormitory', 'Private room for family / group'] })
  @IsIn(['Male dormitory', 'Female dormitory', 'Mixed-gender dormitory', 'Private room for family / group'])
  accommodationAllowedFor: string;

  @ApiProperty({ enum: ['Standard', 'Deluxe', 'AC', 'Non-AC', 'Capsule / Pod', 'Bunk-bed room'] })
  @IsIn(['Standard', 'Deluxe', 'AC', 'Non-AC', 'Capsule / Pod', 'Bunk-bed room'])
  category: string;

  @ApiProperty({ enum: ['Single bunk', 'Upper bunk', 'Lower bunk', 'Single bed', 'Capsule / Pod'] })
  @IsIn(['Single bunk', 'Upper bunk', 'Lower bunk', 'Single bed', 'Capsule / Pod'])
  bedType: string;

  @ApiProperty({ enum: ['Upper', 'Lower', 'Any available bed'] })
  @IsIn(['Upper', 'Lower', 'Any available bed'])
  bedAllocation: string;

  @ApiProperty({ enum: ['Shared room', 'Private dormitory room'] })
  @IsIn(['Shared room', 'Private dormitory room'])
  sleepingArrangement: string;

  @ApiProperty({ enum: ['Yes', 'No'] })
  @IsIn(['Yes', 'No'])
  attachedBathroom: string;

  @ApiProperty({ enum: ['Attached', 'Common'] })
  @IsIn(['Attached', 'Common'])
  bathroomType: string;

  @ApiProperty({ enum: ['Individual locker', 'Shared locker', 'None'] })
  @IsIn(['Individual locker', 'Shared locker', 'None'])
  lockerAvailability: string;

  @ApiProperty({ enum: ['Standard', 'Orthopedic', 'Other'] })
  @IsIn(['Standard', 'Orthopedic', 'Other'])
  mattressType: string;

  @ApiProperty({ enum: ['Each bed', 'Shared'] })
  @IsIn(['Each bed', 'Shared'])
  chargingPoint: string;

  @ApiProperty({ enum: ['Each bed', 'Shared'] })
  @IsIn(['Each bed', 'Shared'])
  readingLight: string;

  @ApiProperty({ enum: ['Yes', 'No'] })
  @IsIn(['Yes', 'No'])
  privacyScreen: string;

  @ApiProperty({ type: [String], enum: ['Bedsheet', 'Pillow', 'Blanket'] })
  @IsArray()
  @IsIn(['Bedsheet', 'Pillow', 'Blanket'], { each: true })
  linenProvided: string[];
}

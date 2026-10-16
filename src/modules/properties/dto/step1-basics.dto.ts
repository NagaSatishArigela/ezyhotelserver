import { normalizeReceptionMobile, normalizeReceptionLandline } from './reception-contact';
import { Transform, Type } from 'class-transformer';
import { OtherAccommodationDto } from './accommodation.dto';
import { ApiProperty } from '@nestjs/swagger';
import {
  BookingPolicy,
  BusinessEntity,
  PropertyCategory,
  PropertyType,
} from '@prisma/client';
import {
  ValidateNested,
  IsEnum,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  MinLength,
} from 'class-validator';
import { StripTags } from '../../../common/decorators/strip-tags.decorator';

/**
 * Step 1 - Basics. Mirrors `step1Schema` in
 * payperhour-next/modules/owner/schemas/index.ts.
 */
export class Step1BasicsDto {
  @ApiProperty({ minLength: 3, maxLength: 100 })
  @IsString()
  @MinLength(3)
  @MaxLength(100)
  propertyName: string;

  @ApiProperty({ enum: PropertyType })
  @IsEnum(PropertyType)
  propertyType: PropertyType;

  @ApiProperty({ required: false, description: 'Required at submission for all services; receives property notifications and status updates' })
  @IsOptional()
  @Transform(({ value }) => normalizeReceptionMobile(value))
  @IsString()
  @Matches(/^[6-9]\d{9}$/, { message: 'Enter a valid 10-digit reception mobile number' })
  receptionMobile?: string;

  @ApiProperty({ required: false, description: 'Optional reception landline including STD code' })
  @IsOptional()
  @Transform(({ value }) => normalizeReceptionLandline(value))
  @IsString()
  @Matches(/^\+?\d{6,15}$/, { message: 'Enter a valid reception landline including STD code' })
  receptionLandline?: string | null;

  @ApiProperty({ required: false, type: OtherAccommodationDto })
  @IsOptional()
  @ValidateNested()
  @Type(() => OtherAccommodationDto)
  otherAccommodation?: OtherAccommodationDto;

  @ApiProperty({ enum: BookingPolicy })
  @IsEnum(BookingPolicy)
  bookingPolicy: BookingPolicy;

  @ApiProperty({ enum: BusinessEntity })
  @IsEnum(BusinessEntity)
  businessEntity: BusinessEntity;

  @ApiProperty({ minLength: 2, maxLength: 50 })
  @IsString()
  @MinLength(2)
  @MaxLength(50)
  @Matches(/^[A-Za-z][A-Za-z .'-]*$/, {
    message: "ownerFirstName may contain letters, spaces, hyphens, apostrophes and dots",
  })
  ownerFirstName: string;

  @ApiProperty({ required: false, maxLength: 50 })
  @IsOptional()
  @IsString()
  @MaxLength(50)
  ownerMiddleName?: string;

  @ApiProperty({ minLength: 2, maxLength: 50 })
  @IsString()
  @MinLength(2)
  @MaxLength(50)
  @Matches(/^[A-Za-z][A-Za-z .'-]*$/, {
    message: "ownerLastName may contain letters, spaces, hyphens, apostrophes and dots",
  })
  ownerLastName: string;

  @ApiProperty({ enum: PropertyCategory })
  @IsEnum(PropertyCategory)
  category: PropertyCategory;

  @ApiProperty({ required: false, maxLength: 200 })
  @IsOptional()
  @StripTags()
  @IsString()
  @MaxLength(200)
  description?: string;
}

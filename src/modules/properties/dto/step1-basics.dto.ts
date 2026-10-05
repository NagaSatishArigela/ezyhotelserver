import { ApiProperty } from '@nestjs/swagger';
import {
  BookingPolicy,
  BusinessEntity,
  PropertyCategory,
  PropertyType,
} from '@prisma/client';
import {
  IsEnum,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
  ValidateBy,
  IsObject,
} from 'class-validator';
import { propertyDetailsErrors, requiredBookingPolicy, type PropertyDetails } from '../constants/property-details';
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

  @ApiProperty({ enum: BookingPolicy })
  @IsEnum(BookingPolicy)
  @ValidateBy({ name: 'propertyBookingPolicy', validator: {
    validate: (value, args) => {
      const expected = requiredBookingPolicy((args?.object as Step1BasicsDto).propertyType);
      return !expected || value === expected;
    },
    defaultMessage: () => 'PG supports full-day bookings only; banquets support hourly bookings only',
  } })
  bookingPolicy: BookingPolicy;

  @ApiProperty({ required: false, type: Object })
  @IsOptional()
  @IsObject()
  @ValidateBy({ name: 'propertyDetails', validator: {
    validate: (value, args) => propertyDetailsErrors((args?.object as Step1BasicsDto).propertyType, value).length === 0,
    defaultMessage: args => propertyDetailsErrors((args?.object as Step1BasicsDto).propertyType, args?.value).join('; '),
  } })
  propertyDetails?: PropertyDetails;

  @ApiProperty({ enum: BusinessEntity })
  @IsEnum(BusinessEntity)
  businessEntity: BusinessEntity;

  @ApiProperty({ minLength: 1, maxLength: 50 })
  @IsString()
  @MinLength(1)
  @MaxLength(50)
  ownerFirstName: string;

  @ApiProperty({ required: false, maxLength: 50 })
  @IsOptional()
  @IsString()
  @MaxLength(50)
  ownerMiddleName?: string;

  @ApiProperty({ required: false, minLength: 1, maxLength: 50 })
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(50)
  ownerLastName?: string;

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

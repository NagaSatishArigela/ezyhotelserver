import { ApiProperty } from '@nestjs/swagger';
import { BookingPolicy, PropertyCategory, PropertyType } from '@prisma/client';
import {
  IsEnum,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  MinLength,
} from 'class-validator';

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
  bookingPolicy: BookingPolicy;

  @ApiProperty({ minLength: 2, maxLength: 50 })
  @IsString()
  @MinLength(2)
  @MaxLength(50)
  @Matches(/^[A-Za-z]+$/, { message: 'ownerFirstName must contain letters only' })
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
  @Matches(/^[A-Za-z]+$/, { message: 'ownerLastName must contain letters only' })
  ownerLastName: string;

  @ApiProperty({ enum: PropertyCategory })
  @IsEnum(PropertyCategory)
  category: PropertyCategory;

  @ApiProperty({ required: false, maxLength: 200 })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  description?: string;
}

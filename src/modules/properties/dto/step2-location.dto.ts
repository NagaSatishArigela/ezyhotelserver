import { ApiProperty } from '@nestjs/swagger';
import {
  IsLatitude,
  IsLongitude,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  MinLength,
} from 'class-validator';
import { StripTags } from '../../../common/decorators/strip-tags.decorator';

/**
 * Step 2 - Location. Mirrors `step2Schema` in
 * payperhour-next/modules/owner/schemas/index.ts.
 */
export class Step2LocationDto {
  @ApiProperty()
  @IsLatitude()
  latitude: number;

  @ApiProperty()
  @IsLongitude()
  longitude: number;

  @ApiProperty({ minLength: 5, maxLength: 150 })
  @IsString()
  @MinLength(5)
  @MaxLength(150)
  addressLine1: string;

  @ApiProperty({ minLength: 5, maxLength: 300 })
  @IsString()
  @MinLength(5)
  @MaxLength(300)
  addressLine2: string;

  @ApiProperty()
  @IsString()
  @Matches(/^\d{6}$/, { message: 'pincode must be a valid 6-digit pincode' })
  pincode: string;

  @ApiProperty({ minLength: 2, maxLength: 80 })
  @IsString()
  @MinLength(2)
  @MaxLength(80)
  city: string;

  @ApiProperty({ minLength: 2 })
  @IsString()
  @MinLength(2)
  state: string;

  @ApiProperty({ required: false, maxLength: 100 })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  landmark?: string;

  @ApiProperty({ required: false, maxLength: 200 })
  @IsOptional()
  @StripTags()
  @IsString()
  @MaxLength(200)
  specialNote?: string;
}

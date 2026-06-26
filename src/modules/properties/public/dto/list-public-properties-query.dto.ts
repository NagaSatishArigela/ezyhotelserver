import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsIn,
  IsISO8601,
  IsInt,
  IsNumberString,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { BookingType } from '@prisma/client';

export type PublicPropertySortParam = 'relevance' | 'price_asc' | 'price_desc' | 'newest';

/** GET /properties/public - guest-facing discovery query params (M4: search/filter/sort). */
export class ListPublicPropertiesQueryDto {
  @ApiPropertyOptional({ default: 1, minimum: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page: number = 1;

  @ApiPropertyOptional({ default: 20, minimum: 1, maximum: 50 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(50)
  limit: number = 20;

  @ApiPropertyOptional({ description: 'Free-text search across name, description, landmark, city' })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  q?: string;

  @ApiPropertyOptional({ description: 'Exact city match (case-insensitive)' })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  city?: string;

  @ApiPropertyOptional({ description: 'Minimum hourly rate in paise', minimum: 0 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  minPrice?: number;

  @ApiPropertyOptional({ description: 'Maximum hourly rate in paise', minimum: 0 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  maxPrice?: number;

  @ApiPropertyOptional({ description: 'Comma-separated amenity list - property must have all' })
  @IsOptional()
  @IsString()
  amenities?: string;

  @ApiPropertyOptional({
    description: 'Accepted for forward-compatibility but ignored - no Reviews module yet (M4 spec §1)',
  })
  @IsOptional()
  @IsNumberString()
  rating?: string;

  @ApiPropertyOptional({ description: 'Availability filter: requested check-in instant (ISO 8601)' })
  @IsOptional()
  @IsISO8601()
  checkInAt?: string;

  @ApiPropertyOptional({ description: 'Availability filter: requested duration in hours', minimum: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  durationHours?: number;

  @ApiPropertyOptional({ enum: BookingType, default: BookingType.hourly })
  @IsOptional()
  @IsIn([BookingType.hourly, BookingType.fullday])
  bookingType?: BookingType;

  @ApiPropertyOptional({ enum: ['relevance', 'price_asc', 'price_desc', 'newest'] })
  @IsOptional()
  @IsIn(['relevance', 'price_asc', 'price_desc', 'newest'])
  sort?: PublicPropertySortParam;
}

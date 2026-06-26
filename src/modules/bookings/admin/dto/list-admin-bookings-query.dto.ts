import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsEnum,
  IsIn,
  IsInt,
  IsISO8601,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  Min,
  MinLength,
} from 'class-validator';
import { BookingStatus, BookingType } from '@prisma/client';

const SORT_FIELDS = ['createdAt', 'checkInAt', 'checkOutAt', 'totalAmountPaise'] as const;
export type AdminBookingSortField = (typeof SORT_FIELDS)[number];

/** GET /admin/bookings - filter/sort/pagination params (M5 spec §3.1). */
export class ListAdminBookingsQueryDto {
  @ApiPropertyOptional({ description: 'Filters on checkInAt (default: 7 days ago)' })
  @IsOptional()
  @IsISO8601()
  dateFrom?: string;

  @ApiPropertyOptional({ description: 'Filters on checkInAt (default: now)' })
  @IsOptional()
  @IsISO8601()
  dateTo?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  city?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  propertyId?: string;

  @ApiPropertyOptional({ enum: BookingType })
  @IsOptional()
  @IsEnum(BookingType)
  bookingType?: BookingType;

  @ApiPropertyOptional({
    description: 'Comma-separated list of BookingStatus values',
    type: String,
  })
  @IsOptional()
  @Transform(({ value }) => (typeof value === 'string' ? value.split(',') : value))
  @IsArray()
  @ArrayMinSize(1)
  @IsEnum(BookingStatus, { each: true })
  status?: BookingStatus[];

  @ApiPropertyOptional({ description: 'Minimum totalAmountPaise' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  amountMin?: number;

  @ApiPropertyOptional({ description: 'Maximum totalAmountPaise' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  amountMax?: number;

  @ApiPropertyOptional({ description: 'Partial match on guest phone, min 3 chars' })
  @IsOptional()
  @IsString()
  @MinLength(3)
  guestPhone?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  bookingRef?: string;

  @ApiPropertyOptional({ default: 1, minimum: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page: number = 1;

  @ApiPropertyOptional({ default: 50, minimum: 1, maximum: 100 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit: number = 50;

  @ApiPropertyOptional({ enum: SORT_FIELDS, default: 'createdAt' })
  @IsOptional()
  @IsIn(SORT_FIELDS)
  sort: AdminBookingSortField = 'createdAt';

  @ApiPropertyOptional({ enum: ['asc', 'desc'], default: 'desc' })
  @IsOptional()
  @IsIn(['asc', 'desc'])
  order: 'asc' | 'desc' = 'desc';
}

/** GET /admin/bookings/kpis - same filters minus pagination/sort. */
export class AdminBookingKpisQueryDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsISO8601()
  dateFrom?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsISO8601()
  dateTo?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  city?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  propertyId?: string;

  @ApiPropertyOptional({ enum: BookingType })
  @IsOptional()
  @IsEnum(BookingType)
  bookingType?: BookingType;

  @ApiPropertyOptional({ type: String })
  @IsOptional()
  @Transform(({ value }) => (typeof value === 'string' ? value.split(',') : value))
  @IsArray()
  @ArrayMinSize(1)
  @IsEnum(BookingStatus, { each: true })
  status?: BookingStatus[];

  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  amountMin?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  amountMax?: number;

  @ApiPropertyOptional({ description: 'Partial match on guest phone, min 3 chars' })
  @IsOptional()
  @IsString()
  @MinLength(3)
  guestPhone?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  bookingRef?: string;
}

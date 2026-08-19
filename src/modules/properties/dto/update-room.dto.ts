import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsInt, IsOptional, Max, Min } from 'class-validator';

/**
 * Owner edit of a single existing room type on a live property. `type` is NOT
 * editable (it's part of the unique key and defines the inventory). Rates are
 * in RUPEES here (owner-facing) and converted to *Paise on save. Editing rates
 * affects only future bookings; existing bookings keep their captured price.
 */
export class UpdateRoomDto {
  @ApiPropertyOptional({ minimum: 0, maximum: 500 })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(500)
  count?: number;

  @ApiPropertyOptional({ description: 'Hourly rate in rupees', minimum: 100, maximum: 100000 })
  @IsOptional()
  @IsInt()
  @Min(100)
  @Max(100000)
  hourlyRate?: number;

  @ApiPropertyOptional({ description: 'Full-day rate in rupees', minimum: 500, maximum: 500000 })
  @IsOptional()
  @IsInt()
  @Min(500)
  @Max(500000)
  fulldayRate?: number;

  @ApiPropertyOptional({ minimum: 1, maximum: 20 })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(20)
  maxOccupancy?: number;
}

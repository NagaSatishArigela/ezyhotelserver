import { Type } from 'class-transformer';
import { IsInt, IsNumber, IsOptional, Max, Min } from 'class-validator';

export class UpdateSettingsDto {
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(30)
  commissionPct?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(6)
  payoutDayOfWeek?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(4)
  minBookingHours?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(8)
  @Max(48)
  maxBookingHours?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(72)
  cancellationWindowHours?: number;
}

import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { BookingStatus } from '@prisma/client';
import { IsEnum, IsInt, IsOptional, Max, Min } from 'class-validator';

export class ListBookingsQueryDto {
  @ApiPropertyOptional({ enum: BookingStatus })
  @IsOptional()
  @IsEnum(BookingStatus)
  status?: BookingStatus;

  @ApiPropertyOptional({ default: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page: number = 1;

  @ApiPropertyOptional({ default: 20 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit: number = 20;
}

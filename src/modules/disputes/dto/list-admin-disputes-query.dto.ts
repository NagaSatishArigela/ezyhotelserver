import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsEnum,
  IsISO8601,
  IsInt,
  IsOptional,
  IsUUID,
  Max,
  Min,
} from 'class-validator';
import { DisputeCategory, DisputeStatus } from '@prisma/client';

/** GET /admin/disputes - filter/sort/pagination params (M6 spec §3.2). */
export class ListAdminDisputesQueryDto {
  @ApiPropertyOptional({ description: 'Comma-separated list of DisputeStatus values', type: String })
  @IsOptional()
  @Transform(({ value }) => (typeof value === 'string' ? value.split(',') : value))
  @IsArray()
  @ArrayMinSize(1)
  @IsEnum(DisputeStatus, { each: true })
  status?: DisputeStatus[];

  @ApiPropertyOptional({ description: 'Comma-separated list of DisputeCategory values', type: String })
  @IsOptional()
  @Transform(({ value }) => (typeof value === 'string' ? value.split(',') : value))
  @IsArray()
  @ArrayMinSize(1)
  @IsEnum(DisputeCategory, { each: true })
  category?: DisputeCategory[];

  @ApiPropertyOptional({ description: 'Filters on filedAt' })
  @IsOptional()
  @IsISO8601()
  dateFrom?: string;

  @ApiPropertyOptional({ description: 'Filters on filedAt' })
  @IsOptional()
  @IsISO8601()
  dateTo?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  propertyId?: string;

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

  @ApiPropertyOptional({ enum: ['asc', 'desc'], default: 'asc', description: 'Order by resolutionDeadline' })
  @IsOptional()
  @IsEnum(['asc', 'desc'])
  order: 'asc' | 'desc' = 'asc';
}

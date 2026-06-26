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
} from 'class-validator';
import { AnomalySeverity, AnomalyStatus } from '@prisma/client';

const SORT_FIELDS = ['severity', 'detectedAt', 'status'] as const;
export type AdminAnomalySortField = (typeof SORT_FIELDS)[number];

/** GET /admin/anomalies - filter/sort/pagination params (M5B spec §3.1). */
export class ListAdminAnomaliesQueryDto {
  @ApiPropertyOptional({ description: 'Comma-separated list of AnomalySeverity values', type: String })
  @IsOptional()
  @Transform(({ value }) => (typeof value === 'string' ? value.split(',') : value))
  @IsArray()
  @ArrayMinSize(1)
  @IsEnum(AnomalySeverity, { each: true })
  severity?: AnomalySeverity[];

  @ApiPropertyOptional({ description: "Exact rule id, e.g. 'ANO-001'" })
  @IsOptional()
  @IsString()
  ruleId?: string;

  @ApiPropertyOptional({ description: 'Comma-separated list of AnomalyStatus values', type: String })
  @IsOptional()
  @Transform(({ value }) => (typeof value === 'string' ? value.split(',') : value))
  @IsArray()
  @ArrayMinSize(1)
  @IsEnum(AnomalyStatus, { each: true })
  status?: AnomalyStatus[];

  @ApiPropertyOptional({ description: 'Filters on detectedAt' })
  @IsOptional()
  @IsISO8601()
  dateFrom?: string;

  @ApiPropertyOptional({ description: 'Filters on detectedAt' })
  @IsOptional()
  @IsISO8601()
  dateTo?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  propertyId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  customerId?: string;

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

  @ApiPropertyOptional({ enum: SORT_FIELDS, default: 'severity' })
  @IsOptional()
  @IsIn(SORT_FIELDS)
  sort: AdminAnomalySortField = 'severity';

  @ApiPropertyOptional({ enum: ['asc', 'desc'], default: 'desc' })
  @IsOptional()
  @IsIn(['asc', 'desc'])
  order: 'asc' | 'desc' = 'desc';
}

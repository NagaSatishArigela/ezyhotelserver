import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsEnum, IsIn, IsOptional, IsString, MaxLength } from 'class-validator';
import { AnomalyStatus } from '@prisma/client';

export const ANOMALY_RESOLUTION_TYPES = [
  'voided_booking',
  'flagged_for_review',
  'contacted_owner',
  'no_action_needed',
  'other',
] as const;

export type AnomalyResolutionType = (typeof ANOMALY_RESOLUTION_TYPES)[number];

const TARGET_STATUSES = [
  AnomalyStatus.investigating,
  AnomalyStatus.resolved_action,
  AnomalyStatus.resolved_fp,
  AnomalyStatus.escalated,
] as const;

/** PATCH /admin/anomalies/:id (M5B spec §3.4). */
export class UpdateAnomalyStatusDto {
  @ApiProperty({ enum: TARGET_STATUSES })
  @IsEnum(AnomalyStatus)
  @IsIn(TARGET_STATUSES)
  status: (typeof TARGET_STATUSES)[number];

  @ApiPropertyOptional({ enum: ANOMALY_RESOLUTION_TYPES })
  @IsOptional()
  @IsIn(ANOMALY_RESOLUTION_TYPES)
  resolutionType?: AnomalyResolutionType;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  resolutionNotes?: string;
}

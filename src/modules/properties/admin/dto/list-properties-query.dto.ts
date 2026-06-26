import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsEnum, IsInt, IsOptional, Max, Min } from 'class-validator';
import { PropertyStatus } from '@prisma/client';

/** GET /admin/properties - moderation queue query params (M2B spec §4.2). */
export class ListPropertiesQueryDto {
  @ApiPropertyOptional({ enum: PropertyStatus, default: PropertyStatus.pending_review })
  @IsOptional()
  @IsEnum(PropertyStatus)
  status: PropertyStatus = PropertyStatus.pending_review;

  @ApiPropertyOptional({ default: 1, minimum: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page: number = 1;

  @ApiPropertyOptional({ default: 20, minimum: 1, maximum: 100 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit: number = 20;
}

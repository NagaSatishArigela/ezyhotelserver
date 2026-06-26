import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsEnum, IsInt, IsOptional, Max, Min } from 'class-validator';
import { Type } from 'class-transformer';
import { PayoutBatchStatus } from '@prisma/client';

export class ListPayoutsQueryDto {
  @ApiPropertyOptional({ default: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number = 1;

  @ApiPropertyOptional({ default: 20 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number = 20;
}

export class ListAdminPayoutsQueryDto extends ListPayoutsQueryDto {
  @ApiPropertyOptional({ enum: PayoutBatchStatus })
  @IsOptional()
  @IsEnum(PayoutBatchStatus)
  status?: PayoutBatchStatus;
}

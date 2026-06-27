import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsEnum, IsInt, IsOptional, IsPositive, IsString, MaxLength } from 'class-validator';
import { StripTags } from '../../../common/decorators/strip-tags.decorator';
import { DisputeResolutionType } from '@prisma/client';

/** PATCH /admin/disputes/:id/resolve (M6 spec §3.7). */
export class ResolveDisputeDto {
  @ApiProperty({ enum: DisputeResolutionType })
  @IsEnum(DisputeResolutionType)
  resolutionType: DisputeResolutionType;

  @ApiPropertyOptional({ description: 'Required for partial_refund, in paise' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @IsPositive()
  refundAmountPaise?: number;

  @ApiPropertyOptional({ description: 'Required for wallet_credit, in paise' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @IsPositive()
  walletCreditAmountPaise?: number;

  @ApiProperty({ description: 'Mandatory admin reasoning for the resolution' })
  @StripTags()
  @IsString()
  @MaxLength(2000)
  adminNotes: string;
}

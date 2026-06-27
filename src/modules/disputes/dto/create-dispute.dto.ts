import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { DisputeCategory, DisputeRequestedResolution } from '@prisma/client';
import { ArrayMaxSize, IsArray, IsEnum, IsOptional, IsString, IsUrl, MaxLength } from 'class-validator';
import { StripTags } from '../../../common/decorators/strip-tags.decorator';

/** POST /bookings/:id/disputes (M6 spec §3.1). */
export class CreateDisputeDto {
  @ApiProperty({ enum: DisputeCategory })
  @IsEnum(DisputeCategory)
  category: DisputeCategory;

  @ApiProperty()
  @StripTags()
  @IsString()
  @MaxLength(2000)
  description: string;

  @ApiProperty({ enum: DisputeRequestedResolution })
  @IsEnum(DisputeRequestedResolution)
  requestedResolution: DisputeRequestedResolution;

  @ApiPropertyOptional({ type: [String], description: 'URLs of evidence photos/screenshots' })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(10)
  @IsUrl({}, { each: true })
  evidence?: string[];
}

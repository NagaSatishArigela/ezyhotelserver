import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, MaxLength } from 'class-validator';
import { StripTags } from '../../../common/decorators/strip-tags.decorator';

export class CancelBookingDto {
  @ApiPropertyOptional({ description: 'Guest-supplied cancellation reason' })
  @IsOptional()
  @StripTags()
  @IsString()
  @MaxLength(500)
  reason?: string;
}

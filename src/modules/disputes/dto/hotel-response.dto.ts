import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { ArrayMaxSize, IsArray, IsOptional, IsString, IsUrl, MaxLength } from 'class-validator';
import { StripTags } from '../../../common/decorators/strip-tags.decorator';

/** POST /disputes/:id/hotel-response (M6 spec §3.6). */
export class HotelResponseDto {
  @ApiProperty()
  @StripTags()
  @IsString()
  @MaxLength(2000)
  response: string;

  @ApiPropertyOptional({ type: [String], description: 'URLs of counter-evidence photos/screenshots' })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(10)
  @IsUrl({}, { each: true })
  evidence?: string[];
}

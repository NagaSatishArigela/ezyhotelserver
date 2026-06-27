import { ApiProperty } from '@nestjs/swagger';
import { IsString, MaxLength, MinLength } from 'class-validator';
import { StripTags } from '../../../common/decorators/strip-tags.decorator';

export class HoldItemDto {
  @ApiProperty({ description: 'Hold reason (min 10 chars)', minLength: 10, maxLength: 500 })
  @StripTags()
  @IsString()
  @MinLength(10)
  @MaxLength(500)
  reason: string;
}

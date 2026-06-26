import { ApiProperty } from '@nestjs/swagger';
import { IsString, MaxLength, MinLength } from 'class-validator';

export class ReplyReviewDto {
  @ApiProperty({ description: 'Owner public reply (1–1000 chars)' })
  @IsString()
  @MinLength(1)
  @MaxLength(1000)
  reply: string;
}

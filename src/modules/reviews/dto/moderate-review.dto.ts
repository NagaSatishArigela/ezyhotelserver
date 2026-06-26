import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsEnum, IsString, MaxLength, ValidateIf } from 'class-validator';

export enum ModerateAction {
  PUBLISH = 'publish',
  REMOVE = 'remove',
}

export class ModerateReviewDto {
  @ApiProperty({ enum: ModerateAction })
  @IsEnum(ModerateAction)
  action: ModerateAction;

  @ApiPropertyOptional({ description: 'Required when action=remove' })
  @ValidateIf((o) => o.action === ModerateAction.REMOVE)
  @IsString()
  @MaxLength(2000)
  reason?: string;
}

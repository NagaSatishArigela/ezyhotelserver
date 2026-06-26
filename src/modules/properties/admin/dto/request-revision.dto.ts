import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsString,
  MinLength,
  ValidateNested,
} from 'class-validator';

export class RevisionItemDto {
  @ApiProperty()
  @IsString()
  @MinLength(1, { message: 'field must not be empty' })
  field: string;

  @ApiProperty()
  @IsString()
  @MinLength(1, { message: 'reason must not be empty' })
  reason: string;
}

/**
 * POST /admin/properties/:id/request-revision - SuperAdmin spec "Mandatory
 * Reasoning" principle: at least one {field, reason} item is required.
 */
export class RequestRevisionDto {
  @ApiProperty({ type: [RevisionItemDto] })
  @IsArray()
  @ArrayMinSize(1, { message: 'items must contain at least one entry' })
  @ValidateNested({ each: true })
  @Type(() => RevisionItemDto)
  items: RevisionItemDto[];
}

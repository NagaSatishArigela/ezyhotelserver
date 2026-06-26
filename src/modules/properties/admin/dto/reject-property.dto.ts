import { ApiProperty } from '@nestjs/swagger';
import { IsString, MinLength } from 'class-validator';

/**
 * POST /admin/properties/:id/reject - SuperAdmin spec "Mandatory Reasoning"
 * principle: a non-empty reason is required for every rejection.
 */
export class RejectPropertyDto {
  @ApiProperty({ minLength: 1 })
  @IsString()
  @MinLength(1, { message: 'reason must not be empty' })
  reason: string;
}

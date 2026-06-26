import { ApiProperty } from '@nestjs/swagger';
import { IsISO8601 } from 'class-validator';

export class GenerateBatchDto {
  @ApiProperty({ example: '2026-06-09T00:00:00.000Z' })
  @IsISO8601()
  cycleStartAt: string;

  @ApiProperty({ example: '2026-06-15T23:59:59.999Z' })
  @IsISO8601()
  cycleEndAt: string;
}

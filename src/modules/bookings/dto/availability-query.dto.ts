import { ApiProperty } from '@nestjs/swagger';
import { IsDateString, IsUUID } from 'class-validator';

export class AvailabilityQueryDto {
  @ApiProperty({ description: 'Room type to check availability for' })
  @IsUUID()
  roomTypeId: string;

  @ApiProperty({ description: 'Date to check, format YYYY-MM-DD' })
  @IsDateString()
  date: string;
}

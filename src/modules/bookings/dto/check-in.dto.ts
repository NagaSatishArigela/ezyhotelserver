import { ApiProperty } from '@nestjs/swagger';
import { IsString } from 'class-validator';

export class CheckInDto {
  @ApiProperty({ description: 'QR code token issued on booking confirmation' })
  @IsString()
  qrCode: string;
}

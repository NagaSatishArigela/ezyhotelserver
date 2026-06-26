import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsBoolean, IsOptional, IsString } from 'class-validator';

export class PaymentConfirmDto {
  @ApiProperty({ description: 'Mock payment gateway result' })
  @IsBoolean()
  success: boolean;

  @ApiPropertyOptional({ description: 'Mock gateway transaction id' })
  @IsOptional()
  @IsString()
  paymentRef?: string;
}

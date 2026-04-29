import { ApiProperty } from '@nestjs/swagger';
import { Matches } from 'class-validator';

export class VerifyOtpDto {
  @ApiProperty({ example: '9876543210', description: '10 digit Indian mobile number' })
  @Matches(/^[6-9]\d{9}$/, {
    message: 'phone must be a valid 10 digit Indian mobile number',
  })
  phone: string;

  @ApiProperty({ example: '123456', description: '6 digit OTP sent to the mobile number' })
  @Matches(/^\d{6}$/, { message: 'otp must be exactly 6 digits' })
  otp: string;
}

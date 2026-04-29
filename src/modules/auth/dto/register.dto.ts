import { Transform } from 'class-transformer';
import { ApiProperty } from '@nestjs/swagger';
import {
  IsEmail,
  IsString,
  Matches,
  MaxLength,
  MinLength,
} from 'class-validator';

export enum VerificationType {
  OTP = 'OTP',
  FIREBASE = 'FIREBASE',
}

export class RegisterDto {
  @ApiProperty({
    example: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
    description: 'Short-lived verification token from OTP or Firebase verification',
  })
  @IsString()
  verificationToken: string;

  @ApiProperty({ example: 'guest@quicknest.in', maxLength: 254 })
  @Transform(({ value }) => String(value).trim().toLowerCase())
  @IsEmail()
  @MaxLength(254)
  email: string;

  @ApiProperty({
    example: 'QuickNest@123',
    minLength: 8,
    maxLength: 128,
    description: 'Must include uppercase, lowercase, number, and special character',
  })
  @IsString()
  @MinLength(8)
  @MaxLength(128)
  @Matches(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[^A-Za-z0-9]).+$/, {
    message:
      'password must include uppercase, lowercase, number, and special character',
  })
  password: string;
}

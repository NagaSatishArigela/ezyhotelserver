import { ApiProperty } from '@nestjs/swagger';
import { IsString, MinLength } from 'class-validator';

export class LogoutDto {
  @ApiProperty({ description: 'Current refresh token to revoke', minLength: 20 })
  @IsString()
  @MinLength(20)
  refreshToken: string;
}

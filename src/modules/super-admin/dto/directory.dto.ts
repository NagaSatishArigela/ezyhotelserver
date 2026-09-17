import { GlobalRole, UserStatus } from '@prisma/client';
import {
  IsBoolean,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { Type } from 'class-transformer';
export class DirectoryQueryDto {
  @IsOptional() @IsString() @MaxLength(120) q?: string;
  @IsOptional() @IsEnum(GlobalRole) globalRole?: GlobalRole;
  @Type(() => Number) @IsInt() @Min(1) page = 1;
  @Type(() => Number) @IsInt() @Min(1) @Max(100) limit = 20;
}
export class UpdatePlatformUserDto {
  @IsOptional() @IsEnum(GlobalRole) globalRole?: GlobalRole;
  @IsOptional() @IsEnum(UserStatus) status?: UserStatus;
}
export class HotelStatusDto {
  @IsBoolean() suspended: boolean;
}

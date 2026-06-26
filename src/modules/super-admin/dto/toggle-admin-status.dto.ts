import { IsEnum } from 'class-validator';
import { UserStatus } from '@prisma/client';

export class ToggleAdminStatusDto {
  @IsEnum(UserStatus)
  status: UserStatus;
}

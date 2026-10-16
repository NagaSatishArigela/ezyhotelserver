import {
  ArrayMaxSize,
  ArrayUnique,
  IsArray,
  IsEmail,
  IsIn,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  MinLength,
} from 'class-validator';
import { PROPERTY_PERMISSIONS, HotelPermission } from './property-permissions';
export class SaveHotelRoleDto {
  @IsString() @MinLength(2) @MaxLength(80) name: string;
  @IsArray()
  @ArrayUnique()
  @ArrayMaxSize(20)
  @IsIn(PROPERTY_PERMISSIONS.filter((p) => p !== 'manage_staff'), { each: true })
  permissions: HotelPermission[];
}
export class AssignMemberDto {
  @IsEmail() email: string;
  @IsOptional() @IsIn(['HOTEL_ADMIN', 'MANAGER', 'STAFF']) role?:
    'HOTEL_ADMIN' | 'MANAGER' | 'STAFF';
  @IsOptional() @IsUUID() hotelRoleId?: string;
}

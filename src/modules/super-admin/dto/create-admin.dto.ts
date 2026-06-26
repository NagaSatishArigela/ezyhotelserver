import { IsEmail, IsOptional, IsString, Length, Matches } from 'class-validator';

export class CreateAdminDto {
  @IsString()
  @Length(2, 120)
  name: string;

  @IsString()
  @Matches(/^\d{10}$/, { message: 'phone must be exactly 10 digits' })
  phone: string;

  @IsEmail()
  @IsOptional()
  email?: string;
}

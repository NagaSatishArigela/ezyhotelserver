import { IsString, Length } from 'class-validator';

export class FirebaseLoginDto {
  @IsString()
  @Length(10, 2048)
  idToken: string;
}

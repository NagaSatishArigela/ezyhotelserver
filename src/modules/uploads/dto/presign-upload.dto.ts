import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsIn, IsInt, IsString, IsUUID, Max, MaxLength, Min } from 'class-validator';

export const UPLOAD_CONTENT_TYPES = [
  'application/pdf',
  'image/jpeg',
  'image/png',
  'image/webp',
] as const;

export type UploadContentType = (typeof UPLOAD_CONTENT_TYPES)[number];
export type UploadKind = 'photo' | 'document';

export class PresignUploadDto {
  @ApiProperty({ enum: ['photo', 'document'] })
  @IsIn(['photo', 'document'])
  kind: UploadKind;

  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  propertyId: string;

  @ApiProperty({ maxLength: 255 })
  @IsString()
  @MaxLength(255)
  fileName: string;

  @ApiProperty({ enum: UPLOAD_CONTENT_TYPES })
  @IsIn(UPLOAD_CONTENT_TYPES)
  contentType: UploadContentType;

  @ApiProperty({ minimum: 1, maximum: 10485760 })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(10 * 1024 * 1024)
  size: number;
}

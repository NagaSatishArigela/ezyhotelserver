import { ApiProperty } from '@nestjs/swagger';
import { IsIn, IsInt, IsString, IsUUID, Max, MaxLength, Min } from 'class-validator';

export class PresignUploadDto {
  @ApiProperty()
  @IsUUID()
  propertyId: string;

  @ApiProperty({ enum: ['photo', 'document'] })
  @IsIn(['photo', 'document'])
  kind: 'photo' | 'document';

  @ApiProperty()
  @IsString()
  @MaxLength(255)
  fileName: string;

  @ApiProperty({ enum: ['image/jpeg', 'image/png', 'image/webp', 'application/pdf'] })
  @IsIn(['image/jpeg', 'image/png', 'image/webp', 'application/pdf'])
  contentType: string;

  @ApiProperty({ minimum: 1, maximum: 10485760 })
  @IsInt()
  @Min(1)
  @Max(10485760)
  size: number;
}

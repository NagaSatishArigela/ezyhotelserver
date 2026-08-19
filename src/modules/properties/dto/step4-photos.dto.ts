import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsOptional,
  IsUrl,
  Min,
  ValidateNested,
} from 'class-validator';

/**
 * Photo categories per the M1 spec (Section 2.1 PropertyPhoto). Mirrors the
 * PHOTO_CATEGORIES keys in payperhour-next/app/owner/onboarding/photos/page.tsx.
 * Stored as a plain string column; max 10 per category / 25 total enforced in
 * the service layer (PropertiesService.MAX_PHOTOS_PER_CATEGORY/MAX_PHOTOS_TOTAL).
 */
export const PHOTO_CATEGORIES = [
  'exterior',
  'room',
  'reception',
  'washroom',
  'common',
] as const;

export type PhotoCategory = (typeof PHOTO_CATEGORIES)[number];

/**
 * Step 4 - Photos. DTOs accept `url` strings for now (M1 spec out-of-scope:
 * S3 presigned-upload pipeline lands separately).
 */
export class PhotoWizardDto {
  @ApiProperty({ enum: PHOTO_CATEGORIES })
  @IsIn(PHOTO_CATEGORIES)
  category: PhotoCategory;

  // Only http/https URLs (require_tld:false so the local uploads host such as
  // http://localhost:3000/uploads/... is accepted); this rejects dangerous
  // schemes like javascript: / data:.
  @ApiProperty()
  @IsUrl({ protocols: ['http', 'https'], require_protocol: true, require_tld: false })
  url: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsBoolean()
  isPrimary?: boolean;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsInt()
  @Min(0)
  sortOrder?: number;
}

export class Step4PhotosDto {
  @ApiProperty({ type: [PhotoWizardDto] })
  @IsArray()
  @ArrayMaxSize(25, { message: 'A maximum of 25 photos are allowed in total' })
  @ValidateNested({ each: true })
  @Type(() => PhotoWizardDto)
  photos: PhotoWizardDto[];
}

import { ApiProperty } from '@nestjs/swagger';
import { DocumentType } from '@prisma/client';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  Equals,
  IsArray,
  IsEnum,
  IsISO8601,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  MinLength,
  ValidateNested,
} from 'class-validator';

const GSTIN_REGEX = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z]{1}[1-9A-Z]{1}Z[0-9A-Z]{1}$/;
const PAN_REGEX = /^[A-Z]{5}[0-9]{4}[A-Z]{1}$/;
const BANK_ACCOUNT_REGEX = /^\d{9,18}$/;
const IFSC_REGEX = /^[A-Z]{4}0[A-Z0-9]{6}$/;

/**
 * Supporting documents (PAN card image, ID proof, fire safety cert, etc.).
 * Not part of the frontend `step5Schema` (which covers only the legal/bank
 * fields) but required by the M1 spec's PropertyDocument model - DTOs accept
 * `url` strings for now (S3 presigned-upload pipeline is out of scope).
 */
export class PropertyDocumentWizardDto {
  @ApiProperty({ enum: DocumentType })
  @IsEnum(DocumentType)
  type: DocumentType;

  @ApiProperty()
  @IsString()
  url: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsISO8601()
  expiresAt?: string;
}

/**
 * Step 5 - Legal & Payout. Mirrors `step5Schema` in
 * payperhour-next/modules/owner/schemas/index.ts plus an optional
 * `documents` array for PropertyDocument rows.
 */
export class Step5LegalDto {
  @ApiProperty()
  @IsString()
  @Matches(GSTIN_REGEX, { message: 'Invalid GSTIN format' })
  gstin: string;

  @ApiProperty({ minLength: 2, maxLength: 200 })
  @IsString()
  @MinLength(2)
  @MaxLength(200)
  legalBusinessName: string;

  @ApiProperty()
  @IsString()
  @Matches(PAN_REGEX, { message: 'Invalid PAN format' })
  pan: string;

  @ApiProperty()
  @IsString()
  @Matches(BANK_ACCOUNT_REGEX, { message: 'Enter 9-18 digit account number' })
  bankAccountNumber: string;

  @ApiProperty()
  @IsString()
  @Matches(IFSC_REGEX, { message: 'Invalid IFSC format' })
  ifsc: string;

  @ApiProperty({ minLength: 2, maxLength: 100 })
  @IsString()
  @MinLength(2)
  @MaxLength(100)
  accountHolderName: string;

  @ApiProperty({ enum: [true] })
  @Equals(true, { message: 'You must accept the Terms & Conditions' })
  tcAccepted: true;

  @ApiProperty({ enum: [true] })
  @Equals(true, { message: 'You must acknowledge Form C obligations' })
  formCAcknowledged: true;

  @ApiProperty({ required: false, type: [PropertyDocumentWizardDto] })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(20)
  @ValidateNested({ each: true })
  @Type(() => PropertyDocumentWizardDto)
  documents?: PropertyDocumentWizardDto[];
}

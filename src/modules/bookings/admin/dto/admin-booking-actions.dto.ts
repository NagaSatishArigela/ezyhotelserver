import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsIn, IsInt, IsISO8601, IsOptional, IsPositive, IsString, MaxLength } from 'class-validator';

const VOID_REASONS = ['fraud', 'emergency', 'duplicate', 'hotel_request', 'other'] as const;
const ADMIN_CANCEL_REASONS = ['guest_request', 'hotel_request', 'admin_decision', 'system_error'] as const;
const FLAG_TYPES = ['suspicious', 'quality_issue', 'partner_complaint', 'other'] as const;

/** POST /admin/bookings/:id/void (M5 spec §3.5). */
export class VoidBookingDto {
  @ApiProperty({ enum: VOID_REASONS })
  @IsIn(VOID_REASONS)
  reasonCategory: (typeof VOID_REASONS)[number];

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(500)
  reasonText?: string;
}

/** POST /admin/bookings/:id/cancel (M5 spec §3.5). */
export class AdminCancelBookingDto {
  @ApiProperty({ enum: ADMIN_CANCEL_REASONS })
  @IsIn(ADMIN_CANCEL_REASONS)
  reasonCategory: (typeof ADMIN_CANCEL_REASONS)[number];

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(500)
  reasonText?: string;
}

/** POST /admin/bookings/:id/refund (M5 spec §3.5). */
export class RefundBookingDto {
  @ApiProperty({ description: 'Amount to refund, in paise' })
  @Type(() => Number)
  @IsInt()
  @IsPositive()
  amountPaise: number;

  @ApiProperty()
  @IsString()
  @MaxLength(100)
  reasonCategory: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(500)
  reasonText?: string;
}

/** POST /admin/bookings/:id/force-checkout (M5 spec §3.5). */
export class ForceCheckoutBookingDto {
  @ApiProperty()
  @IsString()
  @MaxLength(500)
  reasonText: string;
}

/** POST /admin/bookings/:id/extend (M5 spec §3.5). */
export class ExtendBookingDto {
  @ApiProperty({ description: 'New check-out timestamp (ISO 8601)' })
  @IsISO8601()
  newCheckOutAt: string;

  @ApiProperty({ description: 'Extension surcharge, in paise' })
  @Type(() => Number)
  @IsInt()
  @IsPositive()
  extensionAmountPaise: number;
}

/** POST /admin/bookings/:id/flag (M5 spec §3.5). */
export class FlagBookingDto {
  @ApiProperty({ enum: FLAG_TYPES })
  @IsIn(FLAG_TYPES)
  flagType: (typeof FLAG_TYPES)[number];

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(500)
  flagNotes?: string;
}

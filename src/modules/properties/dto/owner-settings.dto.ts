import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsBoolean, IsIn, IsOptional, IsString, Matches } from 'class-validator';

const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;

/**
 * Owner-editable operational settings for a live property. Deliberately narrow:
 * KYC/legal/pricing are NOT editable here (pricing is per-room, see rooms
 * endpoint). `isActive=false` pauses the public listing (owner kill-switch).
 */
export class UpdateOwnerSettingsDto {
  @ApiPropertyOptional({ description: 'Default check-in time, HH:MM (24h)' })
  @IsOptional()
  @IsString()
  @Matches(HHMM, { message: 'defaultCheckinTime must be HH:MM' })
  defaultCheckinTime?: string;

  @ApiPropertyOptional({ description: 'Default check-out time, HH:MM (24h)' })
  @IsOptional()
  @IsString()
  @Matches(HHMM, { message: 'defaultCheckoutTime must be HH:MM' })
  defaultCheckoutTime?: string;

  @ApiPropertyOptional({ enum: [1, 2, 3], description: 'Minimum hourly booking duration' })
  @IsOptional()
  @IsIn([1, 2, 3])
  minBookingHours?: number;

  @ApiPropertyOptional({ description: 'Pause (false) or resume (true) the public listing' })
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

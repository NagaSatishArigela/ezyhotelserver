import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { BookingType } from '@prisma/client';
import {
  IsDateString,
  IsEmail,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';
import { StripTags } from '../../../common/decorators/strip-tags.decorator';

export class CreateBookingDto {
  @ApiProperty({ description: 'Property being booked' })
  @IsUUID()
  propertyId: string;

  @ApiProperty({ description: 'Room type within the property' })
  @IsUUID()
  roomTypeId: string;

  @ApiProperty({ enum: BookingType })
  @IsEnum(BookingType)
  bookingType: BookingType;

  @ApiProperty({ description: 'Requested check-in instant, ISO timestamp' })
  @IsDateString()
  checkInAt: string;

  @ApiPropertyOptional({
    description: 'Required for hourly bookings; ignored for fullday (fixed at 24)',
  })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(24)
  durationHours?: number;

  @ApiProperty({ description: 'Number of guests for this booking' })
  @IsInt()
  @Min(1)
  @Max(50)
  guestCount: number;

  @ApiPropertyOptional({ description: 'Lead guest full name shown to the property at check-in' })
  @IsOptional()
  @IsString()
  @MinLength(2)
  @MaxLength(100)
  guestName?: string;

  @ApiPropertyOptional({ description: 'Lead guest contact phone; accepts +91, spaces and 10-digit forms' })
  @IsOptional()
  @IsString()
  @Matches(/^\+?[\d\s-]{10,15}$/, { message: 'guestPhone must be a valid contact number' })
  guestPhone?: string;

  @ApiPropertyOptional({ description: 'Lead guest email for the booking confirmation' })
  @IsOptional()
  @IsEmail()
  @MaxLength(200)
  guestEmail?: string;

  @ApiPropertyOptional({ description: 'Optional special requests for the stay' })
  @IsOptional()
  @StripTags()
  @IsString()
  @MaxLength(500)
  specialRequests?: string;
}

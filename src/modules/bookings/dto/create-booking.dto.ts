import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { BookingType } from '@prisma/client';
import { IsDateString, IsEnum, IsInt, IsOptional, IsUUID, Max, Min } from 'class-validator';

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
}

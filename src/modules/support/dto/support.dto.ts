import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { SupportTicketPriority, SupportTicketStatus } from '@prisma/client';
import { Type } from 'class-transformer';
import {
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';
import { StripTags } from '../../../common/decorators/strip-tags.decorator';

export class CreateTicketDto {
  @ApiProperty({ minLength: 3, maxLength: 200 })
  @IsString()
  @MinLength(3)
  @MaxLength(200)
  subject: string;

  @ApiProperty({ minLength: 5, maxLength: 2000 })
  @StripTags()
  @IsString()
  @MinLength(5)
  @MaxLength(2000)
  description: string;

  @ApiPropertyOptional({ maxLength: 60 })
  @IsOptional()
  @IsString()
  @MaxLength(60)
  category?: string;

  @ApiPropertyOptional({ enum: SupportTicketPriority })
  @IsOptional()
  @IsEnum(SupportTicketPriority)
  priority?: SupportTicketPriority;
}

export class ResolveTicketDto {
  @ApiProperty({ minLength: 3, maxLength: 1000 })
  @StripTags()
  @IsString()
  @MinLength(3)
  @MaxLength(1000)
  resolutionNote: string;
}

export class ListTicketsQueryDto {
  @ApiPropertyOptional({ enum: SupportTicketStatus })
  @IsOptional()
  @IsEnum(SupportTicketStatus)
  status?: SupportTicketStatus;

  @ApiPropertyOptional({ default: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page: number = 1;

  @ApiPropertyOptional({ default: 20 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit: number = 20;
}

export class LookupUsersQueryDto {
  @ApiProperty({ minLength: 2, maxLength: 100, description: 'Email, phone, or name fragment' })
  @IsString()
  @MinLength(2)
  @MaxLength(100)
  q: string;
}

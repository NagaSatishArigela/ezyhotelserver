import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { GlobalRole, Review, ReviewAuditLog } from '@prisma/client';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { JwtPayload } from '../auth/interfaces/jwt-payload.interface';
import { ListAdminReviewsQueryDto } from './dto/list-reviews-query.dto';
import { ModerateReviewDto } from './dto/moderate-review.dto';
import { ReviewListResult, ReviewsService } from './reviews.service';
import { IsString, MaxLength } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

class DeleteReviewDto {
  @ApiProperty({ description: 'Mandatory reason for hard deletion' })
  @IsString()
  @MaxLength(2000)
  reason: string;
}

@ApiTags('Admin / Reviews')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(GlobalRole.ADMIN, GlobalRole.SUPER_ADMIN)
@Controller('admin/reviews')
export class AdminReviewsController {
  constructor(private readonly reviews: ReviewsService) {}

  @ApiOperation({ summary: 'List all reviews with filters' })
  @Get()
  list(@Query() query: ListAdminReviewsQueryDto): Promise<ReviewListResult> {
    return this.reviews.adminListReviews(query);
  }

  @ApiOperation({ summary: 'Moderation queue — flagged reviews' })
  @Get('flagged')
  flagged(
    @Query('page') page = 1,
    @Query('limit') limit = 20,
  ): Promise<ReviewListResult> {
    return this.reviews.adminListFlagged(Number(page), Number(limit));
  }

  @ApiOperation({ summary: 'Count of flagged reviews (sidebar badge)' })
  @Get('flagged-count')
  flaggedCount(): Promise<{ count: number }> {
    return this.reviews.adminFlaggedCount();
  }

  @ApiOperation({ summary: 'Full audit log for a review' })
  @Get(':id/audit')
  audit(@Param('id', ParseUUIDPipe) id: string): Promise<ReviewAuditLog[]> {
    return this.reviews.adminAuditLog(id);
  }

  @ApiOperation({ summary: 'Publish or remove a flagged review' })
  @Post(':id/moderate')
  moderate(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: JwtPayload,
    @Body() dto: ModerateReviewDto,
  ): Promise<Review> {
    return this.reviews.adminModerate(id, user.id, dto.action, dto.reason);
  }

  @ApiOperation({ summary: 'Hard-remove any review (mandatory reason)' })
  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  async remove(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: JwtPayload,
    @Body() dto: DeleteReviewDto,
  ): Promise<void> {
    return this.reviews.adminDeleteReview(id, user.id, dto.reason);
  }
}

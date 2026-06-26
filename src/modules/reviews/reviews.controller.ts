import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { JwtPayload } from '../auth/interfaces/jwt-payload.interface';
import { FlagReviewDto } from './dto/flag-review.dto';
import { ListReviewsQueryDto } from './dto/list-reviews-query.dto';
import { SubmitReviewDto } from './dto/submit-review.dto';
import { PendingReviewItem, PropertyRatingSummary, ReviewListResult, ReviewsService } from './reviews.service';
import { Review } from '@prisma/client';

@ApiTags('Reviews')
@Controller()
export class ReviewsController {
  constructor(private readonly reviews: ReviewsService) {}

  // ─── Guest: Submit ────────────────────────────────────────────────────────

  @ApiOperation({ summary: 'Submit a review for a completed booking' })
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  @Post('reviews')
  submit(@CurrentUser() user: JwtPayload, @Body() dto: SubmitReviewDto): Promise<Review> {
    return this.reviews.submitReview(user.id, dto);
  }

  @ApiOperation({ summary: 'List bookings awaiting review (guest)' })
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  @Get('reviews/pending')
  pending(@CurrentUser() user: JwtPayload): Promise<{ bookings: PendingReviewItem[] }> {
    return this.reviews.getPendingReviews(user.id);
  }

  @ApiOperation({ summary: 'All reviews submitted by the authenticated guest' })
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  @Get('reviews/my')
  myReviews(@CurrentUser() user: JwtPayload): Promise<ReviewListResult> {
    return this.reviews.getMyReviews(user.id);
  }

  @ApiOperation({ summary: 'Report a published review (guest)' })
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  @Post('reviews/:id/report')
  report(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: JwtPayload,
    @Body() dto: FlagReviewDto,
  ): Promise<void> {
    return this.reviews.reportReview(id, user.id, dto.reason);
  }

  // ─── Public: Property reviews ─────────────────────────────────────────────

  @ApiOperation({ summary: 'Paginated published reviews for a property (public)' })
  @Get('properties/:id/reviews')
  propertyReviews(
    @Param('id', ParseUUIDPipe) id: string,
    @Query() query: ListReviewsQueryDto,
  ): Promise<ReviewListResult> {
    return this.reviews.getPublicReviews(id, query);
  }

  @ApiOperation({ summary: 'Rating summary for a property (public)' })
  @Get('properties/:id/reviews/summary')
  propertySummary(@Param('id', ParseUUIDPipe) id: string): Promise<PropertyRatingSummary> {
    return this.reviews.getPropertySummary(id);
  }
}

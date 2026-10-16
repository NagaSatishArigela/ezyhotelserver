import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Review } from '@prisma/client';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { PropertyPermission } from '../auth/property-permissions';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { PropertyRoleGuard } from '../auth/guards/property-role.guard';
import { JwtPayload } from '../auth/interfaces/jwt-payload.interface';
import { FlagReviewDto } from './dto/flag-review.dto';
import { ReplyReviewDto } from './dto/reply-review.dto';
import { ReviewListResult, ReviewsService } from './reviews.service';

@ApiTags('Owner / Reviews')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('owner')
export class OwnerReviewsController {
  constructor(private readonly reviews: ReviewsService) {}

  @ApiOperation({ summary: "All reviews for a property (owner/manager view)" })

  @UseGuards(PropertyRoleGuard)
  @PropertyPermission('manage_reviews')
  @Get('properties/:propertyId/reviews')
  list(
    @Param('propertyId', ParseUUIDPipe) propertyId: string,
    @Query('page') page = 1,
    @Query('limit') limit = 20,
  ): Promise<ReviewListResult> {
    return this.reviews.listForOwner(propertyId, Number(page), Number(limit));
  }

  @ApiOperation({ summary: 'Post a public reply to a review' })

  @Post('reviews/:id/reply')
  reply(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: JwtPayload,
    @Body() dto: ReplyReviewDto,
  ): Promise<Review> {
    return this.reviews.ownerReply(id, user.id, dto.reply, user.globalRole);
  }

  @ApiOperation({ summary: 'Flag a review for admin moderation' })

  @Post('reviews/:id/flag')
  flag(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: JwtPayload,
    @Body() dto: FlagReviewDto,
  ): Promise<void> {
    return this.reviews.ownerFlag(id, user.id, dto.reason, user.globalRole);
  }
}

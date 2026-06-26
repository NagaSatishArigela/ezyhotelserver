import { Controller, Get, Req, UseGuards } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags, ApiUnauthorizedResponse } from '@nestjs/swagger';
import { Request } from 'express';
import { AuthService } from '../services/auth.service';
import { JwtAuthGuard } from '../guards/jwt-auth.guard';
import { JwtPayload } from '../interfaces/jwt-payload.interface';
import { PrismaService } from '../../database/prisma.service';

type MeRequest = Request & { user?: JwtPayload };

@ApiTags('Me')
@UseGuards(JwtAuthGuard)
@Controller()
export class MeController {
  constructor(
    private readonly authService: AuthService,
    private readonly prisma: PrismaService,
  ) {}

  @ApiOperation({ summary: 'Get current authenticated user profile' })
  @ApiOkResponse({ description: 'Authenticated user profile returned' })
  @ApiUnauthorizedResponse({ description: 'Missing or invalid access token' })
  @Get('auth/me')
  me(@Req() request: MeRequest) {
    return this.authService.getProfile(request.user as JwtPayload);
  }

  @ApiOperation({ summary: 'Get current user capabilities for onboarding and admin flows' })
  @ApiOkResponse({ description: 'User capabilities returned' })
  @ApiUnauthorizedResponse({ description: 'Missing or invalid access token' })
  @Get('me/capabilities')
  capabilities(@Req() request: MeRequest) {
    return this.authService.getCapabilities(request.user as JwtPayload);
  }

  @ApiOperation({ summary: 'Get current user onboarding state' })
  @ApiOkResponse({ description: 'User onboarding state returned' })
  @ApiUnauthorizedResponse({ description: 'Missing or invalid access token' })
  @Get('me/onboarding')
  onboarding(@Req() request: MeRequest) {
    return this.authService.getOnboarding(request.user as JwtPayload);
  }

  @ApiOperation({ summary: "Get the owner's most recent property status (for portal routing)" })
  @ApiOkResponse({ description: 'Property status or nulls if owner has no property yet' })
  @ApiUnauthorizedResponse({ description: 'Missing or invalid access token' })
  @Get('me/property-status')
  async propertyStatus(@Req() request: MeRequest) {
    const { id } = request.user as JwtPayload;
    const property = await this.prisma.property.findFirst({
      where: { ownerId: id },
      orderBy: { createdAt: 'desc' },
      select: { id: true, status: true, submissionRef: true, draftStep: true },
    });
    return property ?? { id: null, status: null, submissionRef: null, draftStep: null };
  }
}

import { Controller, Get, Req, UseGuards } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags, ApiUnauthorizedResponse } from '@nestjs/swagger';
import { Request } from 'express';
import { AuthService } from '../services/auth.service';
import { JwtAuthGuard } from '../guards/jwt-auth.guard';
import { JwtPayload } from '../interfaces/jwt-payload.interface';

type MeRequest = Request & { user?: JwtPayload };

@ApiTags('Me')
@UseGuards(JwtAuthGuard)
@Controller()
export class MeController {
  constructor(private readonly authService: AuthService) {}

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
}

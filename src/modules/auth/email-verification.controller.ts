import { Body, Controller, Post, UseGuards } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { Matches } from 'class-validator';
import { CurrentUser } from './decorators/current-user.decorator';
import { JwtAuthGuard } from './guards/jwt-auth.guard';
import { JwtPayload } from './interfaces/jwt-payload.interface';
import { EmailVerificationService } from './email-verification.service';
export class VerifyEmailDto { @Matches(/^[a-f0-9]{64}$/) code: string; }
@Controller('auth/email-verification')
@UseGuards(JwtAuthGuard)
export class EmailVerificationController {
  constructor(private readonly verification: EmailVerificationService) {}
  @Post('request')
  @Throttle({ strict: { limit: 3, ttl: 3600000 } })
  request(@CurrentUser() user: JwtPayload) { return this.verification.request(user.id); }
  @Post('confirm')
  @Throttle({ strict: { limit: 10, ttl: 60000 } })
  confirm(@CurrentUser() user: JwtPayload, @Body() dto: VerifyEmailDto) { return this.verification.confirm(user.id, dto.code); }
}

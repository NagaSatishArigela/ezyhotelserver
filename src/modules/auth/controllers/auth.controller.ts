import { Body, Controller, Post, Req } from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiConflictResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  ApiTooManyRequestsResponse,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { Request } from 'express';
import { LoginDto } from '../dto/login.dto';
import { LogoutDto } from '../dto/logout.dto';
import { RefreshTokenDto } from '../dto/refresh-token.dto';
import { RegisterDto } from '../dto/register.dto';
import { SendOtpDto } from '../dto/send-otp.dto';
import { VerifyOtpDto } from '../dto/verify-otp.dto';
import { FirebaseLoginDto } from '../dto/firebase-login.dto';
import { AuthService } from '../services/auth.service';

type AuthRequest = Request;

@ApiTags('Auth')
@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @ApiOperation({ summary: 'Send OTP to an Indian mobile number' })
  @ApiOkResponse({
    description: 'OTP accepted for delivery',
    schema: {
      example: {
        message: 'OTP sent successfully',
        expiresIn: 300,
        resendAfter: 30,
      },
    },
  })
  @ApiBadRequestResponse({ description: 'Invalid phone number' })
  @ApiTooManyRequestsResponse({ description: 'Rate limit, cooldown, or lock active' })
  @Post('send-otp')
  sendOtp(@Body() dto: SendOtpDto) {
    return this.authService.sendOtp(dto);
  }

  @ApiOperation({ summary: 'Verify OTP and login existing users or continue registration' })
  @ApiOkResponse({
    description: 'OTP verified. Existing users receive tokens; new users continue to registration.',
    schema: {
      examples: {
        existingUser: {
          value: {
            needsRegistration: false,
            user: {
              id: '0bb3c81a-cb04-42a9-9414-7f362a5bb143',
              phone: '9876543210',
              email: 'guest@quicknest.in',
              globalRole: 'USER',
              isPhoneVerified: true,
              isEmailVerified: false,
              status: 'active',
              refreshTokenExpiresAt: '2026-05-03T00:00:00.000Z',
              createdAt: '2026-04-26T00:00:00.000Z',
              updatedAt: '2026-04-26T00:00:00.000Z',
            },
            tokens: {
              accessToken: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...',
              refreshToken: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...',
              tokenType: 'Bearer',
              expiresIn: 900,
            },
          },
        },
        newUser: {
          value: {
            needsRegistration: true,
            message: 'Phone verified successfully',
            verificationToken: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
          },
        },
      },
    },
  })
  @ApiBadRequestResponse({ description: 'Expired or incorrect OTP' })
  @ApiTooManyRequestsResponse({ description: 'OTP verification locked' })
  @Post('verify-otp')
  verifyOtp(@Body() dto: VerifyOtpDto, @Req() request: AuthRequest) {
    return this.authService.verifyOtp(dto, this.sessionMetadata(request));
  }

  @ApiOperation({ summary: 'Register a user after verification' })
  @ApiOkResponse({ description: 'User registered and tokens issued' })
  @ApiBadRequestResponse({ description: 'Invalid verification token or payload is invalid' })
  @ApiConflictResponse({ description: 'Phone or email already exists' })
  @Post('register')
  register(@Body() dto: RegisterDto, @Req() request: AuthRequest) {
    return this.authService.register(dto, this.sessionMetadata(request));
  }

  @ApiOperation({ summary: 'Login with email and password fallback' })
  @ApiOkResponse({ description: 'Credentials accepted and tokens issued' })
  @ApiUnauthorizedResponse({ description: 'Invalid credentials' })
  @Post('login')
  login(@Body() dto: LoginDto, @Req() request: AuthRequest) {
    return this.authService.login(dto, this.sessionMetadata(request));
  }

  @ApiOperation({ summary: 'Verify Firebase phone auth token and login or continue registration' })
  @ApiOkResponse({ description: 'Firebase verified user logged in or registration required' })
  @ApiBadRequestResponse({ description: 'Invalid Firebase token' })
  @Post('firebase')
  firebaseLogin(@Body() dto: FirebaseLoginDto, @Req() request: AuthRequest) {
    return this.authService.firebaseLogin(dto, this.sessionMetadata(request));
  }

  @ApiOperation({ summary: 'Rotate refresh token and issue a new access token' })
  @ApiOkResponse({ description: 'Refresh token rotated successfully' })
  @ApiUnauthorizedResponse({ description: 'Invalid, revoked, or expired refresh token' })
  @Post('refresh-token')
  refreshToken(@Body() dto: RefreshTokenDto, @Req() request: AuthRequest) {
    return this.authService.refreshToken(dto, this.sessionMetadata(request));
  }

  @ApiOperation({ summary: 'Revoke the current refresh token' })
  @ApiOkResponse({
    description: 'Refresh token revoked',
    schema: { example: { message: 'Logged out successfully' } },
  })
  @ApiUnauthorizedResponse({ description: 'Invalid refresh token' })
  @Post('logout')
  logout(@Body() dto: LogoutDto) {
    return this.authService.logout(dto);
  }

  private sessionMetadata(request: AuthRequest) {
    return {
      device: request.get('user-agent'),
      ip: request.ip,
    };
  }
}

import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcrypt';
import { User } from '@prisma/client';
import { AuthTokens } from '../interfaces/auth-tokens.interface';
import { JwtPayload } from '../interfaces/jwt-payload.interface';

const ACCESS_TOKEN_SECONDS = 15 * 60;
const REFRESH_TOKEN_SECONDS = 7 * 24 * 60 * 60;

@Injectable()
export class TokenService {
  constructor(
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
  ) {}

  async createTokens(user: User, sessionId: string): Promise<AuthTokens> {
    const payload: JwtPayload = {
      id: user.id,
      phone: user.phone,
      globalRole: user.globalRole,
      sessionId,
    };

    const [accessToken, refreshToken] = await Promise.all([
      this.jwt.signAsync(payload, {
        secret: this.config.getOrThrow<string>('JWT_ACCESS_SECRET'),
        expiresIn: ACCESS_TOKEN_SECONDS,
      }),
      this.jwt.signAsync(payload, {
        secret: this.config.getOrThrow<string>('JWT_REFRESH_SECRET'),
        expiresIn: REFRESH_TOKEN_SECONDS,
      }),
    ]);

    return {
      accessToken,
      refreshToken,
      tokenType: 'Bearer',
      expiresIn: ACCESS_TOKEN_SECONDS,
    };
  }

  hashRefreshToken(refreshToken: string): Promise<string> {
    return bcrypt.hash(refreshToken, 12);
  }

  compareRefreshToken(refreshToken: string, hash: string): Promise<boolean> {
    return bcrypt.compare(refreshToken, hash);
  }

  async verifyRefreshToken(refreshToken: string): Promise<JwtPayload> {
    try {
      return await this.jwt.verifyAsync<JwtPayload>(refreshToken, {
        secret: this.config.getOrThrow<string>('JWT_REFRESH_SECRET'),
      });
    } catch (error) {
      if (error && typeof error === 'object' && 'name' in error) {
        const name = (error as Record<string, unknown>).name;
        if (name === 'TokenExpiredError') {
          throw new UnauthorizedException('Refresh token expired');
        }
      }
      throw new UnauthorizedException('Invalid refresh token');
    }
  }

  refreshTokenExpiresAt(): Date {
    return new Date(Date.now() + REFRESH_TOKEN_SECONDS * 1000);
  }
}

import { UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { GlobalRole, User, UserStatus } from '@prisma/client';
import { TokenService } from '../services/token.service';

describe(TokenService.name, () => {
  const jwt = new JwtService();
  const config = {
    getOrThrow: jest.fn((key: string) => {
      if (key === 'JWT_ACCESS_SECRET') {
        return 'access-secret-for-tests-access-secret';
      }
      if (key === 'JWT_REFRESH_SECRET') {
        return 'refresh-secret-for-tests-refresh-secret';
      }
      throw new Error(`Unexpected config key ${key}`);
    }),
  };
  const service = new TokenService(jwt, config as unknown as ConfigService);

  const user: User = {
    id: '0bb3c81a-cb04-42a9-9414-7f362a5bb143',
    phone: '9876543210',
    email: 'guest@ezyhotels.in',
    name: null,
    passwordHash: 'hash',
    globalRole: GlobalRole.USER,
    isPhoneVerified: true,
    isEmailVerified: false,
    status: UserStatus.active,
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  it('signs JWT payload with id, globalRole, and sessionId (no phone — PII must not be in token)', async () => {
    const tokens = await service.createTokens(user, 'session-1');
    const payload = jwt.verify(tokens.accessToken, {
      secret: 'access-secret-for-tests-access-secret',
    });

    expect(payload).toMatchObject({
      id: user.id,
      globalRole: GlobalRole.USER,
      sessionId: 'session-1',
    });
    expect(payload).not.toHaveProperty('phone');
    expect(payload).not.toHaveProperty('email');
    expect(payload).not.toHaveProperty('sub');
  });

  it('rejects expired access tokens', () => {
    const expiredToken = jwt.sign(
      {
        id: user.id,
        globalRole: GlobalRole.USER,
      },
      { secret: 'access-secret-for-tests-access-secret', expiresIn: '-1s' },
    );

    expect(() =>
      jwt.verify(expiredToken, {
        secret: 'access-secret-for-tests-access-secret',
      }),
    ).toThrow();
  });

  it('throws UnauthorizedException for invalid refresh tokens', async () => {
    await expect(service.verifyRefreshToken('invalid')).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
  });
});

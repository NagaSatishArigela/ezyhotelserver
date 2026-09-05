import { ConflictException, ForbiddenException, HttpException, HttpStatus, Logger, UnauthorizedException } from '@nestjs/common';
import { GlobalRole, Session, User, UserStatus } from '@prisma/client';
import * as bcrypt from 'bcrypt';
import { AuthService } from '../services/auth.service';
import { VerificationType } from '../dto/register.dto';

jest.mock('bcrypt', () => ({
  hash: jest.fn(),
  compare: jest.fn(),
}));

const now = new Date('2026-04-26T00:00:00.000Z');

const activeUser: User = {
  id: '0bb3c81a-cb04-42a9-9414-7f362a5bb143',
  phone: '9876543210',
  email: 'guest@ezyhotels.in',
  name: null,
  passwordHash: '$2b$12$password',
  globalRole: GlobalRole.USER,
  isPhoneVerified: true,
  isEmailVerified: false,
  status: UserStatus.active,
  createdAt: now,
  updatedAt: now,
};

const activeSession: Session = {
  id: '5b0cfbf7-ad2b-4b69-a977-813f2ec1769f',
  userId: activeUser.id,
  refreshTokenHash: '$2b$12$refresh',
  device: 'jest',
  ip: '127.0.0.1',
  expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
  createdAt: now,
  updatedAt: now,
  revokedAt: null,
};

describe(AuthService.name, () => {
  beforeAll(() => {
    jest.spyOn(Logger.prototype, 'log').mockImplementation();
    jest.spyOn(Logger.prototype, 'warn').mockImplementation();
    jest.spyOn(Logger.prototype, 'error').mockImplementation();
  });

  const users = {
    findByPhone: jest.fn(),
    findByEmail: jest.fn(),
    findById: jest.fn(),
    create: jest.fn(),
    createSession: jest.fn(),
    findSessionById: jest.fn(),
    rotateSessionRefreshToken: jest.fn(),
    revokeSession: jest.fn(),
  };
  const otp = {
    send: jest.fn(),
    verify: jest.fn(),
    consumeVerificationToken: jest.fn(),
    createVerificationToken: jest.fn(),
  };
  const tokens = {
    createTokens: jest.fn(),
    hashRefreshToken: jest.fn(),
    compareRefreshToken: jest.fn(),
    verifyRefreshToken: jest.fn(),
    refreshTokenExpiresAt: jest.fn(),
  };
  const firebase = {
    verifyIdToken: jest.fn(),
  };
  const events = {
    emit: jest.fn(),
    on: jest.fn(),
  };
  const redisClient = {
    get: jest.fn(),
    del: jest.fn(),
    incr: jest.fn(),
    expire: jest.fn(),
    ttl: jest.fn(),
  };
  const redis = { client: redisClient };

  let service: AuthService;

  beforeEach(() => {
    jest.clearAllMocks();
    jest.mocked(bcrypt.hash).mockResolvedValue('password-hash' as never);
    jest.mocked(bcrypt.compare).mockResolvedValue(true as never);
    // Default: no lockout active, Redis ops succeed
    redisClient.get.mockResolvedValue(null);
    redisClient.del.mockResolvedValue(1);
    redisClient.incr.mockResolvedValue(1);
    redisClient.expire.mockResolvedValue(1);
    redisClient.ttl.mockResolvedValue(1800);
    service = new AuthService(
      users as never,
      otp as never,
      tokens as never,
      firebase as never,
      events as never,
      redis as never,
    );
    tokens.createTokens.mockResolvedValue({
      accessToken: 'access-token',
      refreshToken: 'refresh-token',
      tokenType: 'Bearer',
      expiresIn: 900,
    });
    tokens.hashRefreshToken.mockResolvedValue('hashed-refresh-token');
    tokens.refreshTokenExpiresAt.mockReturnValue(
      new Date('2026-05-03T00:00:00.000Z'),
    );
    users.createSession.mockResolvedValue(activeSession);
    users.rotateSessionRefreshToken.mockResolvedValue(true);
  });

  it('registers a verified phone and consumes the verification token after create succeeds', async () => {
    users.findByPhone.mockResolvedValue(null);
    users.findByEmail.mockResolvedValue(null);
    otp.consumeVerificationToken.mockResolvedValue('9876543210');
    users.create.mockResolvedValue(activeUser);

    const result = await service.register({
      verificationToken: 'token-123',
      email: 'guest@ezyhotels.in',
      password: 'EzyHotels@123',
    });

    expect(otp.consumeVerificationToken).toHaveBeenCalledWith('token-123');
    expect(users.create).toHaveBeenCalledWith(
      expect.objectContaining({
        phone: '9876543210',
        email: 'guest@ezyhotels.in',
        passwordHash: 'password-hash',
        globalRole: GlobalRole.USER,
      }),
    );
    expect(result.user).not.toHaveProperty('passwordHash');
    expect(result.tokens.refreshToken).toBe('refresh-token');
    expect(users.createSession).toHaveBeenCalledWith(
      expect.objectContaining({
        refreshTokenHash: 'hashed-refresh-token',
        user: { connect: { id: activeUser.id } },
      }),
    );
  });

  it('rejects duplicate email during registration', async () => {
    otp.consumeVerificationToken.mockResolvedValue('9876543210');
    users.findByPhone.mockResolvedValue(null);
    users.findByEmail.mockResolvedValue(activeUser);

    await expect(
      service.register({
        verificationToken: 'token-123',
        email: 'guest@ezyhotels.in',
        password: 'EzyHotels@123',
      }),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(otp.consumeVerificationToken).toHaveBeenCalledWith('token-123');
  });

  it('rejects duplicate phone during registration', async () => {
    otp.consumeVerificationToken.mockResolvedValue('9876543210');
    users.findByPhone.mockResolvedValue(activeUser);
    users.findByEmail.mockResolvedValue(null);

    await expect(
      service.register({
        verificationToken: 'token-123',
        email: 'guest@ezyhotels.in',
        password: 'EzyHotels@123',
      }),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(otp.consumeVerificationToken).toHaveBeenCalledWith('token-123');
  });

  it('logs in an existing user after OTP verification', async () => {
    otp.verify.mockResolvedValue({ verificationToken: 'token-123' });
    users.findByPhone.mockResolvedValue(activeUser);

    const result = await service.verifyOtp({
      phone: '9876543210',
      otp: '123456',
    });

    expect(result).toMatchObject({
      needsRegistration: false,
      tokens: { accessToken: 'access-token', refreshToken: 'refresh-token' },
    });
    expect(users.createSession).toHaveBeenCalledWith(
      expect.objectContaining({
        refreshTokenHash: 'hashed-refresh-token',
        user: { connect: { id: activeUser.id } },
      }),
    );
  });

  it('returns needsRegistration for verified phone without a user', async () => {
    otp.verify.mockResolvedValue({ verificationToken: 'token-123' });
    users.findByPhone.mockResolvedValue(null);

    await expect(
      service.verifyOtp({ phone: '9876543210', otp: '123456' }),
    ).resolves.toEqual({
      needsRegistration: true,
      message: 'Phone verified successfully',
      verificationToken: 'token-123',
      verificationType: VerificationType.OTP,
    });
  });

  it('returns registration required for new Firebase phone auth', async () => {
    firebase.verifyIdToken.mockResolvedValue({
      phone_number: '9876543210',
      email: 'guest@ezyhotels.in',
    });
    users.findByPhone.mockResolvedValue(null);
    otp.createVerificationToken.mockResolvedValue('firebase-token-123');

    const result = await service.firebaseLogin({ idToken: 'firebase-id-token' }, {
      device: 'jest',
      ip: '127.0.0.1',
    });

    expect(result).toMatchObject({
      status: 'REGISTRATION_REQUIRED',
      firebaseVerified: true,
      phone: '9876543210',
      verificationToken: 'firebase-token-123',
      verificationType: VerificationType.FIREBASE,
    });
    expect(otp.createVerificationToken).toHaveBeenCalledWith(
      '9876543210',
      VerificationType.FIREBASE,
    );
  });

  it('logs in existing user with Firebase phone auth', async () => {
    firebase.verifyIdToken.mockResolvedValue({ phone_number: '9876543210' });
    users.findByPhone.mockResolvedValue(activeUser);

    const result = await service.firebaseLogin({ idToken: 'firebase-id-token' }, {
      device: 'jest',
      ip: '127.0.0.1',
    });

    expect(result).toMatchObject({
      status: 'OK',
      tokens: { accessToken: 'access-token', refreshToken: 'refresh-token' },
    });
  });

  it('rejects OTP login for inactive users', async () => {
    otp.verify.mockResolvedValue({ verificationToken: 'token-123' });
    users.findByPhone.mockResolvedValue({
      ...activeUser,
      status: UserStatus.suspended,
    });

    await expect(
      service.verifyOtp({ phone: '9876543210', otp: '123456' }),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('rotates refresh tokens', async () => {
    tokens.verifyRefreshToken.mockResolvedValue({
      id: activeUser.id,
      sessionId: activeSession.id,
    });
    users.findById.mockResolvedValue(activeUser);
    users.findSessionById.mockResolvedValue(activeSession);
    tokens.compareRefreshToken.mockResolvedValue(true);

    await expect(
      service.refreshToken({ refreshToken: 'valid-refresh-token' }),
    ).resolves.toMatchObject({
      accessToken: 'access-token',
      refreshToken: 'refresh-token',
    });
    expect(users.rotateSessionRefreshToken).toHaveBeenCalledWith(
      activeSession.id,
      activeSession.refreshTokenHash,
      'hashed-refresh-token',
    );
  });

  it('does not extend session expiry when rotating refresh tokens', async () => {
    tokens.verifyRefreshToken.mockResolvedValue({
      id: activeUser.id,
      sessionId: activeSession.id,
    });
    users.findById.mockResolvedValue(activeUser);
    users.findSessionById.mockResolvedValue(activeSession);
    tokens.compareRefreshToken.mockResolvedValue(true);

    await service.refreshToken({ refreshToken: 'valid-refresh-token' });

    expect(users.rotateSessionRefreshToken).toHaveBeenCalledWith(
      activeSession.id,
      activeSession.refreshTokenHash,
      'hashed-refresh-token',
    );
    // expiresAt must remain unchanged - rotation only swaps the hash, it
    // does not extend the session's lifetime (fixed-window expiry).
    expect(users.rotateSessionRefreshToken).not.toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      expect.anything(),
      expect.objectContaining({ expiresAt: expect.anything() }),
    );
  });

  it('allows multiple sessions per user', async () => {
    users.findByEmail.mockResolvedValue(activeUser);
    const firstSession = { ...activeSession, id: 'session-1' };
    const secondSession = { ...activeSession, id: 'session-2' };
    users.createSession
      .mockResolvedValueOnce(firstSession)
      .mockResolvedValueOnce(secondSession);

    await service.login(
      { email: activeUser.email, password: 'EzyHotels@123' },
      { device: 'device-a', ip: '127.0.0.1' },
    );
    await service.login(
      { email: activeUser.email, password: 'EzyHotels@123' },
      { device: 'device-b', ip: '127.0.0.2' },
    );

    expect(users.createSession).toHaveBeenCalledTimes(2);
  });

  it('blocks login after 5 consecutive failed attempts (account lockout)', async () => {
    users.findByEmail.mockResolvedValue(activeUser);
    redisClient.get.mockResolvedValue('5'); // 5 failures recorded
    redisClient.ttl.mockResolvedValue(1200); // 20 minutes remaining

    await expect(
      service.login({ email: activeUser.email, password: 'wrong' }),
    ).rejects.toBeInstanceOf(HttpException);

    const err = await service
      .login({ email: activeUser.email, password: 'wrong' })
      .catch((e: HttpException) => e);
    expect((err as HttpException).getStatus()).toBe(HttpStatus.TOO_MANY_REQUESTS);
  });

  it('clears the fail counter on successful login', async () => {
    users.findByEmail.mockResolvedValue(activeUser);
    redisClient.get.mockResolvedValue('2'); // 2 previous failures, not yet locked

    await service.login({ email: activeUser.email, password: 'EzyHotels@123' });

    expect(redisClient.del).toHaveBeenCalledWith(`login:fail:${activeUser.id}`);
  });

  it('rejects expired sessions during refresh and revokes them', async () => {
    tokens.verifyRefreshToken.mockResolvedValue({
      id: activeUser.id,
      sessionId: activeSession.id,
    });
    users.findById.mockResolvedValue(activeUser);
    users.findSessionById.mockResolvedValue({
      ...activeSession,
      expiresAt: new Date(Date.now() - 1000),
    });

    await expect(
      service.refreshToken({ refreshToken: 'expired-refresh-token' }),
    ).rejects.toBeInstanceOf(UnauthorizedException);
    expect(users.revokeSession).toHaveBeenCalledWith(activeSession.id);
  });

  it('rejects invalid sessionId in refresh token', async () => {
    tokens.verifyRefreshToken.mockResolvedValue({
      id: activeUser.id,
      sessionId: 'missing-session',
    });
    users.findById.mockResolvedValue(activeUser);
    users.findSessionById.mockResolvedValue(null);

    await expect(
      service.refreshToken({ refreshToken: 'refresh-token' }),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('rejects parallel refresh replay when conditional rotation loses', async () => {
    tokens.verifyRefreshToken.mockResolvedValue({
      id: activeUser.id,
      sessionId: activeSession.id,
    });
    users.findById.mockResolvedValue(activeUser);
    users.findSessionById.mockResolvedValue(activeSession);
    tokens.compareRefreshToken.mockResolvedValue(true);
    users.rotateSessionRefreshToken.mockResolvedValue(false);

    await expect(
      service.refreshToken({ refreshToken: 'valid-refresh-token' }),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('rejects refresh token reuse after rotation', async () => {
    tokens.verifyRefreshToken.mockResolvedValue({
      id: activeUser.id,
      sessionId: activeSession.id,
    });
    users.findById.mockResolvedValue(activeUser);
    users.findSessionById.mockResolvedValue(activeSession);
    tokens.compareRefreshToken.mockResolvedValue(false);

    await expect(
      service.refreshToken({ refreshToken: 'old-refresh-token' }),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('invalidates refresh token on logout', async () => {
    tokens.verifyRefreshToken.mockResolvedValue({
      id: activeUser.id,
      sessionId: activeSession.id,
    });
    users.findSessionById.mockResolvedValue(activeSession);
    tokens.compareRefreshToken.mockResolvedValue(true);

    await expect(
      service.logout({ refreshToken: 'valid-refresh-token' }),
    ).resolves.toEqual({ message: 'Logged out successfully' });
    expect(users.revokeSession).toHaveBeenCalledWith(activeSession.id);
  });

  it('returns success when logout is called again for an already revoked or missing session', async () => {
    tokens.verifyRefreshToken.mockResolvedValue({
      id: activeUser.id,
      sessionId: activeSession.id,
    });
    users.findSessionById.mockResolvedValue(null);

    await expect(
      service.logout({ refreshToken: 'valid-refresh-token' }),
    ).resolves.toEqual({ message: 'Logged out successfully' });
    expect(users.revokeSession).not.toHaveBeenCalled();
  });
});

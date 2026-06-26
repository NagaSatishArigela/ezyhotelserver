import {
  ConflictException,
  ForbiddenException,
  HttpException,
  HttpStatus,
  Injectable,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import { Prisma, User } from '@prisma/client';
import * as bcrypt from 'bcrypt';
import { randomUUID } from 'crypto';
import { LoginDto } from '../dto/login.dto';
import { JwtPayload } from '../interfaces/jwt-payload.interface';
import { LogoutDto } from '../dto/logout.dto';
import { RefreshTokenDto } from '../dto/refresh-token.dto';
import { RegisterDto, VerificationType } from '../dto/register.dto';
import { SendOtpDto } from '../dto/send-otp.dto';
import { VerifyOtpDto } from '../dto/verify-otp.dto';
import { FirebaseLoginDto } from '../dto/firebase-login.dto';
import { GlobalRole, UserStatus } from '../entities/user.entity';
import { AuthTokens } from '../interfaces/auth-tokens.interface';
import { SessionMetadata } from '../interfaces/session-metadata.interface';
import { UsersRepository } from '../repositories/user.repository';
import { OtpService } from './otp.service';
import { TokenService } from './token.service';
import { FirebaseService } from './firebase.service';
import { RedisService } from '../../redis/redis.service';
import { TypedEventEmitter } from '../../../common/events/typed-event-emitter.service';
import { DOMAIN_EVENTS } from '../../../common/events/domain-events';

// A pre-computed bcrypt hash with no corresponding plaintext password. Used to
// run a dummy comparison when the user does not exist, so login() takes a
// constant amount of time regardless of whether the email is registered -
// this prevents email-enumeration via timing analysis.
const DUMMY_PASSWORD_HASH =
  '$2b$12$CwTycUXWue0Thq9StjUM0uJ8aOcU/Qy.WhE0dV2OTC0qkO5e2kWyG';

type PublicUser = Omit<User, 'passwordHash'>;

type FirebaseLoginResponse =
  | { status: 'OK'; user: PublicUser; tokens: AuthTokens }
  | {
      status: 'REGISTRATION_REQUIRED';
      firebaseVerified: true;
      phone: string;
      verificationToken: string;
      verificationType: VerificationType;
    };

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  private static readonly LOGIN_FAIL_MAX = 5;
  private static readonly LOGIN_FAIL_WINDOW_SEC = 30 * 60; // 30-minute lockout window

  constructor(
    private readonly users: UsersRepository,
    private readonly otp: OtpService,
    private readonly tokens: TokenService,
    private readonly firebase: FirebaseService,
    private readonly events: TypedEventEmitter,
    private readonly redis: RedisService,
  ) {}

  async sendOtp(dto: SendOtpDto) {
    const result = await this.otp.send(dto.phone);
    this.logger.log({ event: 'auth.otp.sent', phone: this.maskPhone(dto.phone) });
    return {
      message: 'OTP sent successfully',
      ...result,
    };
  }

  async getProfile(payload: JwtPayload) {
    const user = await this.users.findById(payload.id);
    if (!user) {
      throw new UnauthorizedException('User not found');
    }
    return {
      id: user.id,
      phone: user.phone,
      email: user.email,
      globalRole: user.globalRole,
    };
  }

  async getCapabilities(payload: JwtPayload) {
    const user = await this.users.findById(payload.id);
    if (!user) {
      throw new UnauthorizedException('User not found');
    }
    const isAdmin = user.globalRole !== GlobalRole.USER;
    return {
      canOnboardProperty: user.globalRole === GlobalRole.USER,
      isAdmin,
    };
  }

  async getOnboarding(payload: JwtPayload) {
    const user = await this.users.findById(payload.id);
    if (!user) {
      throw new UnauthorizedException('User not found');
    }
    const isAdmin = user.globalRole !== GlobalRole.USER;
    return {
      status: isAdmin ? 'NOT_APPLICABLE' : 'READY',
      canOnboardProperty: user.globalRole === GlobalRole.USER,
      isAdmin,
      nextStep: user.globalRole === GlobalRole.USER ? 'CREATE_PROPERTY' : 'ADMIN_DASHBOARD',
    };
  }

  async verifyOtp(dto: VerifyOtpDto, metadata?: SessionMetadata) {
    const { verificationToken } = await this.otp.verify(dto.phone, dto.otp);
    const user = await this.users.findByPhone(dto.phone);

    if (!user) {
      this.logger.log({
        event: 'otp_login',
        status: 'registration_required',
        phone: this.maskPhone(dto.phone),
      });
      return {
        needsRegistration: true,
        message: 'Phone verified successfully',
        verificationToken,
        verificationType: VerificationType.OTP,
      };
    }

    if (user.status !== UserStatus.active) {
      throw new ForbiddenException('User account is not active');
    }

    const tokens = await this.issueAndStoreTokens(user, metadata);
    this.logger.log({
      event: 'otp_login',
      status: 'success',
      userId: user.id,
      globalRole: user.globalRole,
    });
    return {
      needsRegistration: false,
      user: this.toPublicUser(user),
      tokens,
    };
  }

  async register(
    dto: RegisterDto,
    metadata?: SessionMetadata,
  ): Promise<{ user: PublicUser; tokens: AuthTokens }> {
    const phone = await this.otp.consumeVerificationToken(dto.verificationToken);
    const [phoneUser, emailUser] = await Promise.all([
      this.users.findByPhone(phone),
      this.users.findByEmail(dto.email),
    ]);

    if (phoneUser) {
      throw new ConflictException('Phone already exists');
    }
    if (emailUser) {
      throw new ConflictException('Email already exists');
    }

    const passwordHash = await bcrypt.hash(dto.password, 12);

    try {
      const user = await this.users.create({
        phone,
        email: dto.email,
        passwordHash,
        globalRole: GlobalRole.USER,
        isPhoneVerified: true,
        isEmailVerified: false,
        status: UserStatus.active,
      });
      const tokens = await this.issueAndStoreTokens(user, metadata);
      this.logger.log({
        event: 'registration',
        status: 'success',
        userId: user.id,
        globalRole: user.globalRole,
      });
      this.events.emit(DOMAIN_EVENTS.USER_REGISTERED, {
        userId: user.id,
        phone: user.phone,
        email: user.email,
      });
      return { user: this.toPublicUser(user), tokens };
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        throw new ConflictException('Phone or email already exists');
      }
      throw error;
    }
  }

  async login(
    dto: LoginDto,
    metadata?: SessionMetadata,
  ): Promise<{ user: PublicUser; tokens: AuthTokens }> {
    const user = await this.users.findByEmail(dto.email);
    if (!user) {
      // Dummy compare so response time is indistinguishable regardless of email existence
      await bcrypt.compare(dto.password, DUMMY_PASSWORD_HASH);
      this.logger.warn({ event: 'auth.login.failed', reason: 'unknown_email' });
      throw new UnauthorizedException('Invalid credentials');
    }

    if (user.status !== UserStatus.active) {
      throw new ForbiddenException('User account is not active');
    }

    // Per-user lockout: block after LOGIN_FAIL_MAX consecutive failures
    const failKey = `login:fail:${user.id}`;
    const failCount = await this.redis.client.get(failKey);
    if (failCount !== null && parseInt(failCount, 10) >= AuthService.LOGIN_FAIL_MAX) {
      const ttlSec = await this.redis.client.ttl(failKey);
      this.logger.warn({ event: 'auth.login.locked', userId: user.id });
      throw new HttpException(
        `Account temporarily locked. Try again in ${Math.ceil(ttlSec / 60)} minute(s).`,
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    const passwordMatches = await bcrypt.compare(dto.password, user.passwordHash);
    if (!passwordMatches) {
      const newCount = await this.redis.client.incr(failKey);
      if (newCount === 1) {
        // Set the window TTL only on the first failure so the lock expires
        // 30 minutes from the first bad attempt, not each subsequent one.
        await this.redis.client.expire(failKey, AuthService.LOGIN_FAIL_WINDOW_SEC);
      }
      this.logger.warn({ event: 'auth.login.failed', reason: 'invalid_password', userId: user.id });
      throw new UnauthorizedException('Invalid credentials');
    }

    // Successful login — clear the failure counter
    await this.redis.client.del(failKey);

    const tokens = await this.issueAndStoreTokens(user, metadata);
    this.logger.log({ event: 'auth.login.success', userId: user.id, globalRole: user.globalRole });
    return { user: this.toPublicUser(user), tokens };
  }

  async firebaseLogin(
    dto: FirebaseLoginDto,
    metadata?: SessionMetadata,
  ): Promise<FirebaseLoginResponse> {
    const decodedToken = await this.firebase.verifyIdToken(dto.idToken);

    const phone = decodedToken.phone_number;
    if (!phone) {
      throw new UnauthorizedException('Firebase token does not contain phone number');
    }

    const user = await this.users.findByPhone(phone);
    if (!user) {
      const verificationToken = await this.otp.createVerificationToken(
        phone,
        VerificationType.FIREBASE,
      );
      this.logger.log({
        event: 'auth.firebase.verification_required',
        phone: this.maskPhone(phone),
      });
      return {
        status: 'REGISTRATION_REQUIRED',
        firebaseVerified: true,
        phone,
        verificationToken,
        verificationType: VerificationType.FIREBASE,
      };
    }

    if (user.status !== UserStatus.active) {
      throw new ForbiddenException('User account is not active');
    }

    const tokens = await this.issueAndStoreTokens(user, metadata);
    this.logger.log({
      event: 'firebase_login',
      status: 'success',
      userId: user.id,
      globalRole: user.globalRole,
    });
    return { user: this.toPublicUser(user), tokens, status: 'OK' };
  }

  async refreshToken(
    dto: RefreshTokenDto,
    metadata?: SessionMetadata,
  ): Promise<AuthTokens> {
    const payload = await this.tokens.verifyRefreshToken(dto.refreshToken);
    if (!payload.sessionId) {
      this.logger.warn({
        event: 'auth.refresh.failed',
        reason: 'missing_session_id',
      });
      throw new UnauthorizedException('Invalid refresh token');
    }

    const [user, session] = await Promise.all([
      this.users.findById(payload.id),
      this.users.findSessionById(payload.sessionId),
    ]);

    if (!user || !session || session.userId !== user.id || session.revokedAt) {
      this.logger.warn({
        event: 'auth.refresh.failed',
        reason: 'invalid_session',
        userId: payload.id,
        sessionId: payload.sessionId,
      });
      throw new UnauthorizedException('Refresh token has been revoked');
    }
    if (user.status !== UserStatus.active) {
      this.logger.warn({
        event: 'auth.refresh.failed',
        reason: 'user_inactive',
        userId: user.id,
        sessionId: session.id,
      });
      throw new ForbiddenException('User account is not active');
    }
    if (session.expiresAt.getTime() <= Date.now()) {
      await this.users.revokeSession(session.id);
      this.logger.warn({
        event: 'auth.refresh.failed',
        reason: 'expired',
        userId: user.id,
        sessionId: session.id,
      });
      throw new UnauthorizedException('Refresh token expired');
    }
    this.logSessionBindingMismatch(session, metadata);

    const matches = await this.tokens.compareRefreshToken(
      dto.refreshToken,
      session.refreshTokenHash,
    );
    if (!matches) {
      this.logger.warn({
        event: 'auth.refresh.failed',
        reason: 'hash_mismatch',
        userId: user.id,
        sessionId: session.id,
      });
      throw new UnauthorizedException('Invalid refresh token');
    }

    const tokens = await this.issueAndStoreTokens(
      user,
      undefined,
      session.id,
      session.refreshTokenHash,
    );
    this.logger.log({
      event: 'auth.refresh.rotated',
      userId: user.id,
      sessionId: session.id,
    });
    return tokens;
  }

  async logout(dto: LogoutDto): Promise<{ message: string }> {
    const payload = await this.tokens.verifyRefreshToken(dto.refreshToken);
    if (!payload.sessionId) {
      throw new UnauthorizedException('Invalid refresh token');
    }

    const session = await this.users.findSessionById(payload.sessionId);
    if (session && !session.revokedAt && session.userId === payload.id) {
      const matches = await this.tokens.compareRefreshToken(
        dto.refreshToken,
        session.refreshTokenHash,
      );
      if (matches) {
        await this.users.revokeSession(session.id);
        this.logger.log({
          event: 'auth.logout.success',
          userId: payload.id,
          sessionId: session.id,
        });
      }
    }

    return { message: 'Logged out successfully' };
  }

  private async issueAndStoreTokens(
    user: User,
    metadata?: SessionMetadata,
    existingSessionId?: string,
    currentRefreshTokenHash?: string,
  ): Promise<AuthTokens> {
    const sessionId = existingSessionId ?? randomUUID();
    const tokens = await this.tokens.createTokens(user, sessionId);
    const refreshTokenHash = await this.tokens.hashRefreshToken(
      tokens.refreshToken,
    );

    if (existingSessionId) {
      if (!currentRefreshTokenHash) {
        throw new UnauthorizedException('Invalid refresh token');
      }

      const rotated = await this.users.rotateSessionRefreshToken(
        sessionId,
        currentRefreshTokenHash,
        refreshTokenHash,
      );
      if (!rotated) {
        throw new UnauthorizedException('Invalid refresh token');
      }
    } else {
      await this.users.createSession({
        id: sessionId,
        user: { connect: { id: user.id } },
        refreshTokenHash,
        device: metadata?.device,
        ip: metadata?.ip,
        expiresAt: this.tokens.refreshTokenExpiresAt(),
      });
    }

    return tokens;
  }

  private toPublicUser(user: User): PublicUser {
    const { passwordHash: _passwordHash, ...safe } = user;
    return safe;
  }

  private maskPhone(phone: string): string {
    return `${phone.slice(0, 2)}******${phone.slice(-2)}`;
  }

  private logSessionBindingMismatch(
    session: { id: string; userId: string; device: string | null; ip: string | null },
    metadata?: SessionMetadata,
  ): void {
    if (!metadata) {
      return;
    }

    const deviceChanged =
      Boolean(session.device) &&
      Boolean(metadata.device) &&
      session.device !== metadata.device;
    const ipChanged =
      Boolean(session.ip) && Boolean(metadata.ip) && session.ip !== metadata.ip;

    if (deviceChanged || ipChanged) {
      this.logger.warn({
        event: 'auth.session.binding_mismatch',
        userId: session.userId,
        sessionId: session.id,
        deviceChanged,
        ipChanged,
      });
    }
  }
}

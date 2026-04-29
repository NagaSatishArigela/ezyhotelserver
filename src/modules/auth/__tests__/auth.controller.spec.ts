import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { HttpExceptionFilter } from '../../../common/filters/http-exception.filter';
import { AuthController } from '../controllers/auth.controller';
import { AuthService } from '../services/auth.service';

describe(AuthController.name, () => {
  let app: INestApplication;
  const authService = {
    sendOtp: jest.fn(),
    verifyOtp: jest.fn(),
    register: jest.fn(),
    login: jest.fn(),
    refreshToken: jest.fn(),
    logout: jest.fn(),
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    const moduleRef = await Test.createTestingModule({
      controllers: [AuthController],
      providers: [{ provide: AuthService, useValue: authService }],
    }).compile();

    app = moduleRef.createNestApplication();
    app.useGlobalFilters(new HttpExceptionFilter());
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
      }),
    );
    await app.init();
  });

  afterEach(async () => {
    await app.close();
  });

  it('POST /auth/send-otp validates phone and returns OTP metadata', async () => {
    authService.sendOtp.mockResolvedValue({
      message: 'OTP sent successfully',
      expiresIn: 300,
      resendAfter: 30,
    });

    await request(app.getHttpServer())
      .post('/auth/send-otp')
      .send({ phone: '9876543210' })
      .expect(201)
      .expect({
        message: 'OTP sent successfully',
        expiresIn: 300,
        resendAfter: 30,
      });
  });

  it('POST /auth/register rejects invalid password before service execution', async () => {
    await request(app.getHttpServer())
      .post('/auth/register')
      .send({
        phone: '9876543210',
        email: 'guest@quicknest.in',
        password: 'weakpass',
      })
      .expect(400);

    expect(authService.register).not.toHaveBeenCalled();
  });

  it('POST /auth/verify-otp returns login tokens for existing users', async () => {
    authService.verifyOtp.mockResolvedValue({
      needsRegistration: false,
      user: { id: 'user-id', phone: '9876543210', globalRole: 'USER' },
      tokens: {
        accessToken: 'access-token',
        refreshToken: 'refresh-token',
        tokenType: 'Bearer',
        expiresIn: 900,
      },
    });

    await request(app.getHttpServer())
      .post('/auth/verify-otp')
      .send({ phone: '9876543210', otp: '123456' })
      .expect(201)
      .expect((response) => {
        expect(response.body.needsRegistration).toBe(false);
        expect(response.body.tokens.refreshToken).toBe('refresh-token');
      });
  });

  it('POST /auth/logout delegates refresh token revocation', async () => {
    authService.logout.mockResolvedValue({ message: 'Logged out successfully' });

    await request(app.getHttpServer())
      .post('/auth/logout')
      .send({ refreshToken: 'a'.repeat(24) })
      .expect(201)
      .expect({ message: 'Logged out successfully' });
  });
});

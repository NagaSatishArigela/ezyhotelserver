import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { AuthController } from './controllers/auth.controller';
import { MeController } from './controllers/me.controller';
import { JwtAuthGuard } from './guards/jwt-auth.guard';
import { PropertyRoleGuard } from './guards/property-role.guard';
import { RolesGuard } from './guards/roles.guard';
import { UsersRepository } from './repositories/user.repository';
import { AuthService } from './services/auth.service';
import { FirebaseService } from './services/firebase.service';
import { OtpDeliveryService } from './services/otp-delivery.service';
import { OtpService } from './services/otp.service';
import { SessionCleanupService } from './services/session-cleanup.service';
import { TokenService } from './services/token.service';
import { JwtStrategy } from './strategies/jwt.strategy';

@Module({
  imports: [
    PassportModule.register({ defaultStrategy: 'jwt' }),
    JwtModule.register({}),
  ],
  controllers: [AuthController, MeController],
  providers: [
    AuthService,
    FirebaseService,
    OtpService,
    OtpDeliveryService,
    SessionCleanupService,
    TokenService,
    UsersRepository,
    JwtStrategy,
    JwtAuthGuard,
    RolesGuard,
    PropertyRoleGuard,
  ],
  exports: [AuthService, JwtAuthGuard, RolesGuard, PropertyRoleGuard],
})
export class AuthModule {}

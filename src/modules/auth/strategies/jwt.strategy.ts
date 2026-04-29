import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { UserStatus } from '../entities/user.entity';
import { JwtPayload } from '../interfaces/jwt-payload.interface';
import { UsersRepository } from '../repositories/user.repository';

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(
    config: ConfigService,
    private readonly users: UsersRepository,
  ) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: config.getOrThrow<string>('JWT_ACCESS_SECRET'),
    });
  }

  async validate(payload: JwtPayload): Promise<JwtPayload> {
    const user = await this.users.findById(payload.id);
    if (!user || user.status !== UserStatus.active) {
      throw new UnauthorizedException('Invalid access token');
    }

    return {
      id: user.id,
      phone: user.phone,
      globalRole: user.globalRole,
      sessionId: payload.sessionId,
    };
  }
}

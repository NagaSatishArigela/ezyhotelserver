import { ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';

@Injectable()
export class JwtAuthGuard extends AuthGuard('jwt') {
  handleRequest(err: any, user: any, info: any, context: ExecutionContext, status?: any): any {
    if (err || !user) {
      if (info && typeof info === 'object' && 'name' in info) {
        const name = (info as Record<string, unknown>).name;
        if (name === 'TokenExpiredError') {
          throw new UnauthorizedException('Access token expired');
        }
      }
      throw err || new UnauthorizedException('Invalid access token');
    }
    return user;
  }
}

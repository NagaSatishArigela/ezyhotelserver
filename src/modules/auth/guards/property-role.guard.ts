import {
  BadRequestException,
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  Logger,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Request } from 'express';
import { PROPERTY_ROLES_KEY } from '../decorators/property-roles.decorator';
import { GlobalRole, PropertyRole } from '../entities/user.entity';
import { JwtPayload } from '../interfaces/jwt-payload.interface';
import { UsersRepository } from '../repositories/user.repository';

type PropertyScopedRequest = Request & {
  user?: JwtPayload;
  params: Record<string, string | undefined>;
  query: Record<string, string | string[] | undefined>;
  body?: Record<string, unknown>;
};

@Injectable()
export class PropertyRoleGuard implements CanActivate {
  private readonly logger = new Logger(PropertyRoleGuard.name);

  constructor(
    private readonly reflector: Reflector,
    private readonly users: UsersRepository,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const roles = this.reflector.getAllAndOverride<PropertyRole[]>(
      PROPERTY_ROLES_KEY,
      [context.getHandler(), context.getClass()],
    );

    if (!roles?.length) {
      return true;
    }

    const request = context.switchToHttp().getRequest<PropertyScopedRequest>();
    const user = request.user;
    if (!user) {
      throw new ForbiddenException('Authentication required');
    }

    if (
      user.globalRole === GlobalRole.SUPER_ADMIN ||
      user.globalRole === GlobalRole.ADMIN
    ) {
      return true;
    }

    const propertyId = this.extractPropertyId(request);
    if (!propertyId) {
      throw new BadRequestException('Property context is required');
    }

    const allowed = await this.users.hasPropertyRole(
      user.id,
      propertyId,
      roles,
    );

    if (!allowed) {
      this.logger.warn({
        event: 'auth.property_role_denied',
        userId: user.id,
        propertyId,
        requiredRoles: roles,
      });
      throw new ForbiddenException('Insufficient property role');
    }

    return true;
  }

  private extractPropertyId(request: PropertyScopedRequest): string | null {
    const bodyPropertyId =
      typeof request.body?.propertyId === 'string' ? request.body.propertyId : null;
    const queryPropertyId = request.query.propertyId;

    if (request.params.propertyId) {
      return request.params.propertyId;
    }
    if (bodyPropertyId) {
      return bodyPropertyId;
    }
    if (typeof queryPropertyId === 'string') {
      return queryPropertyId;
    }

    return null;
  }
}

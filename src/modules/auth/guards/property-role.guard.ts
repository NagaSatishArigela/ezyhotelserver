import { BadRequestException, CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { PROPERTY_ROLES_KEY } from '../decorators/property-roles.decorator';
import { APPLICATION_ACCESS_KEY, HotelPermission, PROPERTY_PERMISSION_KEY } from '../property-permissions';
import { PropertyAccessService } from '../property-access.service';
@Injectable()
export class PropertyRoleGuard implements CanActivate {
  constructor(private readonly reflector: Reflector, private readonly access: PropertyAccessService) {}
  async canActivate(context: ExecutionContext): Promise<boolean> {
    const targets = [context.getHandler(), context.getClass()];
    const roles = this.reflector.getAllAndOverride<string[]>(PROPERTY_ROLES_KEY, targets) ?? [];
    const permission = this.reflector.getAllAndOverride<HotelPermission | HotelPermission[]>(PROPERTY_PERMISSION_KEY, targets);
    const application = this.reflector.getAllAndOverride<boolean>(APPLICATION_ACCESS_KEY, targets) === true;
    if (!roles.length && !permission && !application) return true;
    const request = context.switchToHttp().getRequest();
    const propertyId = request.params?.propertyId ?? request.body?.propertyId ?? request.query?.propertyId;
    if (typeof propertyId !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(propertyId)) throw new BadRequestException('Valid property context is required');
    await this.access.authorize(request.user, propertyId, permission, application, roles);
    return true;
  }
}

import { SetMetadata } from '@nestjs/common';
import { PropertyRole } from '../entities/user.entity';

export const PROPERTY_ROLES_KEY = 'propertyRoles';
export const PropertyRoles = (...roles: PropertyRole[]) =>
  SetMetadata(PROPERTY_ROLES_KEY, roles);

import { applyDecorators, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../guards/jwt-auth.guard';
import { PropertyRoleGuard } from '../guards/property-role.guard';
import { RolesGuard } from '../guards/roles.guard';

export const UseAuthGuards = () =>
  applyDecorators(UseGuards(JwtAuthGuard, RolesGuard, PropertyRoleGuard));

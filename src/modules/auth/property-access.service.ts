import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { GlobalRole } from '@prisma/client';
import { PrismaService } from '../database/prisma.service';
import {
  DEFAULT_PROPERTY_PERMISSIONS,
  HotelPermission,
  PROPERTY_PERMISSIONS,
} from './property-permissions';

@Injectable()
export class PropertyAccessService {
  constructor(private readonly prisma: PrismaService) {}

  private effectivePermissions(
    property: { id: string; ownerId: string; status: string } | null,
    membership:
      | {
          userId: string;
          role: string;
          hotelRole: { propertyId: string; permissions: string[] } | null;
        }
      | null
      | undefined,
  ): readonly string[] {
    if (!property || property.status !== 'approved' || !membership) return [];
    if (membership.role === 'OWNER')
      return membership.userId === property.ownerId ? DEFAULT_PROPERTY_PERMISSIONS.OWNER : [];
    if (membership.hotelRole && membership.hotelRole.propertyId !== property.id) return [];
    return (
      membership.hotelRole?.permissions ??
      DEFAULT_PROPERTY_PERMISSIONS[membership.role] ??
      []
    ).filter(
      (p) => p !== 'manage_staff' && (PROPERTY_PERMISSIONS as readonly string[]).includes(p),
    );
  }

  async context(userId: string, propertyId: string) {
    const [property, membership] = await Promise.all([
      this.prisma.property.findUnique({ where: { id: propertyId } }),
      this.prisma.userPropertyRole.findUnique({
        where: { userId_propertyId: { userId, propertyId } },
        include: { hotelRole: true },
      }),
    ]);
    const permissions = this.effectivePermissions(property, membership);
    return { property, membership, permissions };
  }

  async authorize(
    user: { id: string; globalRole: GlobalRole },
    propertyId: string,
    permission?: HotelPermission | HotelPermission[],
    application = false,
    roles: string[] = [],
  ) {
    const { property, membership, permissions } = await this.context(user.id, propertyId);
    if (!property) throw new NotFoundException('Property not found');
    if (user.globalRole === GlobalRole.SUPER_ADMIN || user.globalRole === GlobalRole.ADMIN) return;
    if (application) {
      if (property.ownerId === user.id) return;
      throw new ForbiddenException('Only the property applicant can manage this application');
    }
    if (property.status !== 'approved')
      throw new ForbiddenException('Hotel operations require platform approval');
    if (
      permission
        ? (Array.isArray(permission) ? permission : [permission]).some((p) =>
            permissions.includes(p),
          )
        : membership && permissions.length > 0 && roles.includes(membership.role)
    )
      return;
    throw new ForbiddenException('Insufficient hotel permission');
  }

  async memberships(userId: string) {
    const memberships = await this.prisma.userPropertyRole.findMany({
      where: { userId },
      include: { hotelRole: true },
    });
    const properties = await this.prisma.property.findMany({
      where: { OR: [{ ownerId: userId }, { id: { in: memberships.map((m) => m.propertyId) } }] },
      orderBy: { createdAt: 'desc' },
    });
    return properties.map((p) => {
      const m = memberships.find((m) => m.propertyId === p.id);
      return {
        propertyId: p.id,
        name: p.name,
        status: p.status,
        isActive: p.isActive,
        isApplicant: p.ownerId === userId,
        role: p.status === 'approved' ? (m?.role ?? null) : null,
        roleName: m?.hotelRole?.name ?? m?.role ?? null,
        permissions: this.effectivePermissions(p, m),
      };
    });
  }

  catalog() {
    return {
      permissions: PROPERTY_PERMISSIONS.filter((p) => p !== 'manage_staff'),
      roles: DEFAULT_PROPERTY_PERMISSIONS,
    };
  }
}

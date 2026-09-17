import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../database/prisma.service';
import { PropertyAccessService } from './property-access.service';
import { JwtPayload } from './interfaces/jwt-payload.interface';
import { AssignMemberDto, SaveHotelRoleDto } from './hotel-team.dto';

const PUBLIC_USER = { id: true, name: true, email: true, phone: true, status: true } as const;
@Injectable()
export class HotelTeamService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: PropertyAccessService,
  ) {}
  private async authorize(user: JwtPayload, propertyId: string) {
    await this.access.authorize(user, propertyId, 'manage_staff');
    const property = await this.prisma.property.findUniqueOrThrow({ where: { id: propertyId } });
    if (property.status !== 'approved')
      throw new ForbiddenException('Approve the property before managing its team');
    return property;
  }
  async list(user: JwtPayload, propertyId: string) {
    await this.authorize(user, propertyId);
    const [roles, members] = await Promise.all([
      this.prisma.hotelRole.findMany({ where: { propertyId }, orderBy: { name: 'asc' } }),
      this.prisma.userPropertyRole.findMany({
        where: { propertyId },
        include: { user: { select: PUBLIC_USER }, hotelRole: true },
        orderBy: { createdAt: 'asc' },
      }),
    ]);
    return { ...this.access.catalog(), customRoles: roles, members };
  }
  async saveRole(user: JwtPayload, propertyId: string, dto: SaveHotelRoleDto, roleId?: string) {
    await this.authorize(user, propertyId);
    const name = dto.name.trim();
    if (
      name.length < 2 ||
      ['OWNER', 'HOTEL_ADMIN', 'MANAGER', 'STAFF'].includes(name.toUpperCase())
    )
      throw new BadRequestException('Choose a distinct custom role name');
    try {
      if (!roleId)
        return await this.prisma.hotelRole.create({
          data: { propertyId, name, permissions: dto.permissions },
        });
      const result = await this.prisma.hotelRole.updateMany({
        where: { id: roleId, propertyId },
        data: { name, permissions: dto.permissions },
      });
      if (!result.count) throw new NotFoundException('Hotel role not found');
      return this.prisma.hotelRole.findUnique({ where: { id: roleId } });
    } catch (e) {
      if ((e as { code?: string }).code === 'P2002')
        throw new ConflictException('Role name already exists in this hotel');
      throw e;
    }
  }
  async removeRole(user: JwtPayload, propertyId: string, id: string) {
    await this.authorize(user, propertyId);
    try {
      const result = await this.prisma.hotelRole.deleteMany({ where: { id, propertyId } });
      if (!result.count) throw new NotFoundException('Hotel role not found');
    } catch (e) {
      if ((e as { code?: string }).code === 'P2003')
        throw new ConflictException('Reassign members before deleting this role');
      throw e;
    }
    return { success: true };
  }
  async assign(user: JwtPayload, propertyId: string, dto: AssignMemberDto) {
    const property = await this.authorize(user, propertyId);
    if (Boolean(dto.role) === Boolean(dto.hotelRoleId))
      throw new BadRequestException('Select either a standard or custom hotel role');
    const target = await this.prisma.user.findFirst({
      where: {
        email: { equals: dto.email.trim(), mode: 'insensitive' },
        status: 'active',
        globalRole: 'USER',
      },
      select: PUBLIC_USER,
    });
    if (!target)
      throw new NotFoundException(
        'An active registered customer account with this email is required',
      );
    if (target.id === property.ownerId)
      throw new ForbiddenException('Owner membership cannot be changed');
    if (
      dto.hotelRoleId &&
      !(await this.prisma.hotelRole.findFirst({ where: { id: dto.hotelRoleId, propertyId } }))
    )
      throw new NotFoundException('Hotel role not found');
    const data = { role: dto.role ?? ('STAFF' as const), hotelRoleId: dto.hotelRoleId ?? null };
    return this.prisma.userPropertyRole.upsert({
      where: { userId_propertyId: { userId: target.id, propertyId } },
      create: { userId: target.id, propertyId, ...data },
      update: data,
      include: { user: { select: PUBLIC_USER }, hotelRole: true },
    });
  }
  async removeMember(user: JwtPayload, propertyId: string, userId: string) {
    const property = await this.authorize(user, propertyId);
    if (property.ownerId === userId)
      throw new ForbiddenException('Owner membership cannot be removed');
    const result = await this.prisma.userPropertyRole.deleteMany({
      where: { propertyId, userId, role: { not: 'OWNER' } },
    });
    if (!result.count) throw new NotFoundException('Team member not found');
    return { success: true };
  }
}

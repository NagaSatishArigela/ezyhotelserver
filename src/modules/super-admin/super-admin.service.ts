import { PrismaService } from '../database/prisma.service';
import { DirectoryQueryDto, UpdatePlatformUserDto } from './dto/directory.dto';
import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { GlobalRole, PlatformSettings, User, UserStatus } from '@prisma/client';
import * as bcrypt from 'bcrypt';
import { randomBytes } from 'crypto';
import { CreateAdminDto } from './dto/create-admin.dto';
import { UpdateSettingsDto } from './dto/update-settings.dto';
import { AdminListResult, PlatformStats, SuperAdminRepository } from './super-admin.repository';

@Injectable()
export class SuperAdminService {
  constructor(private readonly repo: SuperAdminRepository, private readonly prisma: PrismaService) {}

  async users(query: DirectoryQueryDto) {
    const where = { ...(query.globalRole ? { globalRole: query.globalRole } : {}), ...(query.q ? { OR: ['name', 'email', 'phone'].map(field => ({ [field]: { contains: query.q, mode: 'insensitive' as const } })) } : {}) };
    const [items, total] = await this.prisma.$transaction([
      this.prisma.user.findMany({ where, select: { id: true, name: true, email: true, phone: true, globalRole: true, status: true, createdAt: true, propertyRoles: { select: { propertyId: true, role: true } } }, orderBy: { createdAt: 'desc' }, skip: (query.page - 1) * query.limit, take: query.limit }),
      this.prisma.user.count({ where }),
    ]);
    return { items, total, page: query.page, limit: query.limit };
  }
  async updateUser(id: string, callerId: string, dto: UpdatePlatformUserDto) {
    if (id === callerId) throw new ForbiddenException('Cannot change your own platform role or status');
    const user = await this.prisma.user.findUnique({ where: { id } });
    if (!user) throw new NotFoundException('User not found');
    const updated = await this.prisma.$transaction(async tx => {
      const result = await tx.user.update({ where: { id }, data: dto, select: { id: true, name: true, email: true, phone: true, globalRole: true, status: true } });
      await tx.session.updateMany({ where: { userId: id, revokedAt: null }, data: { revokedAt: new Date() } });
      return result;
    });
    return updated;
  }
  async properties(query: DirectoryQueryDto) {
    const where = query.q ? { OR: [{ name: { contains: query.q, mode: 'insensitive' as const } }, { city: { contains: query.q, mode: 'insensitive' as const } }] } : {};
    const [properties, total] = await this.prisma.$transaction([
      this.prisma.property.findMany({ where, select: { id: true, name: true, city: true, ownerId: true, status: true, isActive: true }, orderBy: { createdAt: 'desc' }, skip: (query.page - 1) * query.limit, take: query.limit }), this.prisma.property.count({ where }),
    ]);
    const owners = await this.prisma.user.findMany({ where: { id: { in: properties.map(p => p.ownerId) } }, select: { id: true, name: true, email: true } });
    return { items: properties.map(p => ({ ...p, owner: owners.find(o => o.id === p.ownerId) })), total, page: query.page, limit: query.limit };
  }
  async suspendHotel(id: string, suspended: boolean) {
    const result = await this.prisma.property.updateMany({ where: { id, status: suspended ? 'approved' : 'suspended' }, data: { status: suspended ? 'suspended' : 'approved' } });
    if (!result.count) throw new ConflictException('Only approved hotels can be suspended; only suspended hotels can be restored');
    return { success: true };
  }

  getStats(): Promise<PlatformStats> {
    return this.repo.getStats();
  }

  listAdmins(page: number, limit: number): Promise<AdminListResult> {
    return this.repo.listAdmins(page, limit);
  }

  async createAdmin(dto: CreateAdminDto): Promise<User> {
    if (!dto.email) {
      throw new BadRequestException('Email is required to create an admin account');
    }
    const tempPassword = randomBytes(8).toString('hex');
    const passwordHash = await bcrypt.hash(tempPassword, 12);

    try {
      return await this.repo.createAdmin({
        name: dto.name,
        phone: dto.phone,
        email: dto.email,
        passwordHash,
        globalRole: GlobalRole.ADMIN,
        status: UserStatus.active,
        isPhoneVerified: false,
        isEmailVerified: false,
      });
    } catch (err: unknown) {
      const pgErr = err as { code?: string };
      if (pgErr.code === 'P2002') {
        throw new ConflictException('A user with this phone or email already exists');
      }
      throw err;
    }
  }

  async toggleAdminStatus(
    targetId: string,
    callerId: string,
    status: UserStatus,
  ): Promise<User> {
    if (targetId === callerId) {
      throw new ForbiddenException('Cannot change the status of your own account');
    }

    const target = await this.repo.findUserById(targetId);
    if (!target) {
      throw new NotFoundException('Admin user not found');
    }
    if (target.globalRole === GlobalRole.SUPER_ADMIN) {
      throw new ForbiddenException('Cannot change the status of a Super Admin account');
    }
    if (target.globalRole === GlobalRole.USER) {
      throw new ForbiddenException('Target is not an admin account');
    }

    return this.repo.updateUserStatus(targetId, status);
  }

  getSettings(): Promise<PlatformSettings> {
    return this.repo.getSettings();
  }

  updateSettings(dto: UpdateSettingsDto, callerId: string): Promise<PlatformSettings> {
    return this.repo.updateSettings({
      ...dto,
      updatedBy: callerId,
    });
  }
}

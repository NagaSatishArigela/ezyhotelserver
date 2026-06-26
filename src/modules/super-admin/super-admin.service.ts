import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { GlobalRole, PlatformSettings, User, UserStatus } from '@prisma/client';
import * as bcrypt from 'bcrypt';
import { randomBytes } from 'crypto';
import { CreateAdminDto } from './dto/create-admin.dto';
import { UpdateSettingsDto } from './dto/update-settings.dto';
import { AdminListResult, PlatformStats, SuperAdminRepository } from './super-admin.repository';

@Injectable()
export class SuperAdminService {
  constructor(private readonly repo: SuperAdminRepository) {}

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

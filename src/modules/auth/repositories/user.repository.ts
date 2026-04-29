import { Injectable } from '@nestjs/common';
import { Prisma, PropertyRole, Session, User } from '@prisma/client';
import { PrismaService } from '../../database/prisma.service';

@Injectable()
export class UsersRepository {
  constructor(private readonly prisma: PrismaService) {}

  findById(id: string): Promise<User | null> {
    return this.prisma.user.findUnique({ where: { id } });
  }

  findByEmail(email: string): Promise<User | null> {
    return this.prisma.user.findUnique({ where: { email } });
  }

  findByPhone(phone: string): Promise<User | null> {
    return this.prisma.user.findUnique({ where: { phone } });
  }

  create(data: Prisma.UserCreateInput): Promise<User> {
    return this.prisma.user.create({ data });
  }

  updateRefreshToken(
    id: string,
    refreshTokenHash: string,
    refreshTokenExpiresAt: Date,
  ): Promise<User> {
    return this.prisma.user.update({
      where: { id },
      data: { refreshTokenHash, refreshTokenExpiresAt },
    });
  }

  clearRefreshToken(id: string): Promise<User> {
    return this.prisma.user.update({
      where: { id },
      data: { refreshTokenHash: null, refreshTokenExpiresAt: null },
    });
  }

  createSession(data: Prisma.SessionCreateInput): Promise<Session> {
    return this.prisma.session.create({ data });
  }

  findSessionById(id: string): Promise<Session | null> {
    return this.prisma.session.findUnique({ where: { id } });
  }

  // Fixed-window session expiry: rotate the refresh token hash atomically without extending expiresAt.
  async rotateSessionRefreshToken(
    id: string,
    currentRefreshTokenHash: string,
    refreshTokenHash: string,
  ): Promise<boolean> {
    const result = await this.prisma.session.updateMany({
      where: {
        id,
        refreshTokenHash: currentRefreshTokenHash,
        revokedAt: null,
        expiresAt: { gt: new Date() },
      },
      data: { refreshTokenHash, revokedAt: null },
    });

    return result.count === 1;
  }

  async revokeExpiredSessions(now = new Date(), batchSize = 500): Promise<number> {
    let totalCount = 0;
    while (true) {
      const sessions = await this.prisma.session.findMany({
        where: {
          expiresAt: { lte: now },
          revokedAt: null,
        },
        select: { id: true },
        take: batchSize,
        orderBy: { id: 'asc' },
      });

      if (sessions.length === 0) {
        break;
      }

      const result = await this.prisma.session.updateMany({
        where: {
          id: { in: sessions.map((session) => session.id) },
          revokedAt: null,
        },
        data: { revokedAt: now },
      });

      totalCount += result.count;
      if (sessions.length < batchSize) {
        break;
      }
    }

    return totalCount;
  }

  revokeSession(id: string): Promise<Session> {
    return this.prisma.session.update({
      where: { id },
      data: { revokedAt: new Date() },
    });
  }

  async hasPropertyRole(
    userId: string,
    propertyId: string,
    roles: PropertyRole[],
  ): Promise<boolean> {
    const propertyRole = await this.prisma.userPropertyRole.findFirst({
      where: {
        userId,
        propertyId,
        role: { in: roles },
      },
      select: { id: true },
    });

    if (propertyRole) {
      return true;
    }

    if (!roles.includes(PropertyRole.OWNER)) {
      return false;
    }

    const ownedProperty = await this.prisma.property.findFirst({
      where: {
        id: propertyId,
        ownerId: userId,
      },
      select: { id: true },
    });

    return Boolean(ownedProperty);
  }
}

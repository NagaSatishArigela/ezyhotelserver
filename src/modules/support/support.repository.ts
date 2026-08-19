import { Injectable } from '@nestjs/common';
import { Prisma, SupportTicket } from '@prisma/client';
import { PrismaService } from '../database/prisma.service';

// Safe user fields for support lookup — never expose passwordHash.
const USER_LOOKUP_SELECT = {
  id: true,
  name: true,
  email: true,
  phone: true,
  globalRole: true,
  status: true,
  createdAt: true,
} satisfies Prisma.UserSelect;

@Injectable()
export class SupportRepository {
  constructor(private readonly prisma: PrismaService) {}

  create(data: Prisma.SupportTicketCreateInput): Promise<SupportTicket> {
    return this.prisma.supportTicket.create({ data });
  }

  findById(id: string): Promise<SupportTicket | null> {
    return this.prisma.supportTicket.findUnique({ where: { id } });
  }

  findMany(
    where: Prisma.SupportTicketWhereInput,
    skip: number,
    take: number,
  ): Promise<[SupportTicket[], number]> {
    return this.prisma.$transaction([
      this.prisma.supportTicket.findMany({ where, orderBy: { createdAt: 'desc' }, skip, take }),
      this.prisma.supportTicket.count({ where }),
    ]);
  }

  update(id: string, data: Prisma.SupportTicketUpdateInput): Promise<SupportTicket> {
    return this.prisma.supportTicket.update({ where: { id }, data });
  }

  lookupUsers(q: string) {
    return this.prisma.user.findMany({
      where: {
        OR: [
          { email: { contains: q, mode: 'insensitive' } },
          { phone: { contains: q } },
          { name: { contains: q, mode: 'insensitive' } },
        ],
      },
      select: USER_LOOKUP_SELECT,
      take: 10,
      orderBy: { createdAt: 'desc' },
    });
  }
}

import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { SupportTicket, SupportTicketStatus } from '@prisma/client';
import { SupportRepository } from './support.repository';
import { CreateTicketDto, ListTicketsQueryDto, ResolveTicketDto } from './dto/support.dto';

@Injectable()
export class SupportService {
  constructor(private readonly repo: SupportRepository) {}

  /** Any authenticated user (guest or owner) can raise a ticket. */
  createTicket(raisedByUserId: string, dto: CreateTicketDto): Promise<SupportTicket> {
    return this.repo.create({
      subject: dto.subject,
      description: dto.description,
      category: dto.category ?? null,
      priority: dto.priority ?? undefined,
      raisedByUserId,
    });
  }

  myTickets(userId: string): Promise<[SupportTicket[], number]> {
    return this.repo.findMany({ raisedByUserId: userId }, 0, 100);
  }

  async listQueue(query: ListTicketsQueryDto) {
    const where = query.status ? { status: query.status } : {};
    const [items, total] = await this.repo.findMany(where, (query.page - 1) * query.limit, query.limit);
    return { items, total, page: query.page, limit: query.limit };
  }

  async getTicket(id: string): Promise<SupportTicket> {
    const ticket = await this.repo.findById(id);
    if (!ticket) throw new NotFoundException('Ticket not found');
    return ticket;
  }

  async resolveTicket(id: string, agentUserId: string, dto: ResolveTicketDto): Promise<SupportTicket> {
    const ticket = await this.getTicket(id);
    if (ticket.status === SupportTicketStatus.resolved) {
      throw new ConflictException('Ticket is already resolved');
    }
    return this.repo.update(id, {
      status: SupportTicketStatus.resolved,
      resolutionNote: dto.resolutionNote,
      assignedToUserId: agentUserId,
      resolvedAt: new Date(),
    });
  }

  async escalateTicket(id: string, agentUserId: string): Promise<SupportTicket> {
    const ticket = await this.getTicket(id);
    if (ticket.status === SupportTicketStatus.resolved) {
      throw new ConflictException('Cannot escalate a resolved ticket');
    }
    return this.repo.update(id, {
      status: SupportTicketStatus.escalated,
      assignedToUserId: agentUserId,
    });
  }

  lookupUsers(q: string) {
    return this.repo.lookupUsers(q);
  }
}

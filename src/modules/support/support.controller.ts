import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { GlobalRole } from '@prisma/client';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { JwtPayload } from '../auth/interfaces/jwt-payload.interface';
import { CreateTicketDto, ListTicketsQueryDto, LookupUsersQueryDto, ResolveTicketDto } from './dto/support.dto';
import { SupportService } from './support.service';

/** Any authenticated user (guest/owner) can raise and track their own tickets. */
@ApiTags('Support')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('support')
export class SupportTicketController {
  constructor(private readonly service: SupportService) {}

  @ApiOperation({ summary: 'Raise a support ticket' })
  @Post('tickets')
  create(@CurrentUser() user: JwtPayload, @Body() dto: CreateTicketDto) {
    return this.service.createTicket(user.id, dto);
  }

  @ApiOperation({ summary: "The current user's own tickets" })
  @Get('my-tickets')
  async mine(@CurrentUser() user: JwtPayload) {
    const [items, total] = await this.service.myTickets(user.id);
    return { items, total };
  }
}

/** Support-agent tooling — restricted to SUPPORT (and admins). */
@ApiTags('Support')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(GlobalRole.SUPPORT, GlobalRole.ADMIN, GlobalRole.SUPER_ADMIN)
@Controller('support')
export class SupportAgentController {
  constructor(private readonly service: SupportService) {}

  @ApiOperation({ summary: 'Ticket queue (filter by status)' })
  @Get('tickets')
  queue(@Query() query: ListTicketsQueryDto) {
    return this.service.listQueue(query);
  }

  @ApiOperation({ summary: 'Ticket detail' })
  @Get('tickets/:id')
  detail(@Param('id', ParseUUIDPipe) id: string) {
    return this.service.getTicket(id);
  }

  @ApiOperation({ summary: 'Resolve a ticket' })
  @Post('tickets/:id/resolve')
  resolve(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: JwtPayload,
    @Body() dto: ResolveTicketDto,
  ) {
    return this.service.resolveTicket(id, user.id, dto);
  }

  @ApiOperation({ summary: 'Escalate a ticket to admin' })
  @Post('tickets/:id/escalate')
  escalate(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: JwtPayload) {
    return this.service.escalateTicket(id, user.id);
  }

  @ApiOperation({ summary: 'Look up users by email/phone/name' })
  @Get('users/lookup')
  lookup(@Query() query: LookupUsersQueryDto) {
    return this.service.lookupUsers(query.q);
  }
}

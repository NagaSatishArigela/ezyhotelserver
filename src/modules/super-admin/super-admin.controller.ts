import {
  Body, Controller, Get, HttpCode, HttpStatus,
  Param, ParseUUIDPipe, Patch, Post, Query, UseGuards,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { GlobalRole } from '@prisma/client';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { JwtPayload } from '../auth/interfaces/jwt-payload.interface';
import { CreateAdminDto } from './dto/create-admin.dto';
import { ListAdminsQueryDto } from './dto/list-admins-query.dto';
import { ToggleAdminStatusDto } from './dto/toggle-admin-status.dto';
import { UpdateSettingsDto } from './dto/update-settings.dto';
import { SuperAdminService } from './super-admin.service';

@ApiTags('Super Admin')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(GlobalRole.SUPER_ADMIN)
@Controller('super-admin')
export class SuperAdminController {
  constructor(private readonly service: SuperAdminService) {}

  @ApiOperation({ summary: 'Platform-wide KPI stats' })
  @Get('stats')
  getStats() {
    return this.service.getStats();
  }

  @ApiOperation({ summary: 'List admin and super-admin users' })
  @Get('admins')
  listAdmins(@Query() query: ListAdminsQueryDto) {
    return this.service.listAdmins(query.page, query.limit);
  }

  @ApiOperation({ summary: 'Create a new admin account' })
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @Post('admins')
  createAdmin(@Body() dto: CreateAdminDto) {
    return this.service.createAdmin(dto);
  }

  @ApiOperation({ summary: 'Suspend or activate an admin account' })
  @Patch('admins/:id/status')
  @HttpCode(HttpStatus.OK)
  toggleStatus(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ToggleAdminStatusDto,
    @CurrentUser() caller: JwtPayload,
  ) {
    return this.service.toggleAdminStatus(id, caller.id, dto.status);
  }

  @ApiOperation({ summary: 'Get platform settings singleton' })
  @Get('settings')
  getSettings() {
    return this.service.getSettings();
  }

  @ApiOperation({ summary: 'Update platform settings' })
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @Patch('settings')
  @HttpCode(HttpStatus.OK)
  updateSettings(@Body() dto: UpdateSettingsDto, @CurrentUser() caller: JwtPayload) {
    return this.service.updateSettings(dto, caller.id);
  }
}

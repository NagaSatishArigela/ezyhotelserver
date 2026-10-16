import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from './guards/jwt-auth.guard';
import { CurrentUser } from './decorators/current-user.decorator';
import { JwtPayload } from './interfaces/jwt-payload.interface';
import { HotelTeamService } from './hotel-team.service';
import { AssignMemberDto, SaveHotelRoleDto } from './hotel-team.dto';
@UseGuards(JwtAuthGuard)
@Controller('properties/:propertyId/team')
export class HotelTeamController {
  constructor(private readonly team: HotelTeamService) {}
  @Get() list(@CurrentUser() user: JwtPayload, @Param('propertyId', ParseUUIDPipe) id: string) {
    return this.team.list(user, id);
  }
  @Post('roles') createRole(
    @CurrentUser() user: JwtPayload,
    @Param('propertyId', ParseUUIDPipe) id: string,
    @Body() dto: SaveHotelRoleDto,
  ) {
    return this.team.saveRole(user, id, dto);
  }
  @Patch('roles/:roleId') updateRole(
    @CurrentUser() user: JwtPayload,
    @Param('propertyId', ParseUUIDPipe) id: string,
    @Param('roleId', ParseUUIDPipe) roleId: string,
    @Body() dto: SaveHotelRoleDto,
  ) {
    return this.team.saveRole(user, id, dto, roleId);
  }
  @Delete('roles/:roleId') removeRole(
    @CurrentUser() user: JwtPayload,
    @Param('propertyId', ParseUUIDPipe) id: string,
    @Param('roleId', ParseUUIDPipe) roleId: string,
  ) {
    return this.team.removeRole(user, id, roleId);
  }
  @Post('members') assign(
    @CurrentUser() user: JwtPayload,
    @Param('propertyId', ParseUUIDPipe) id: string,
    @Body() dto: AssignMemberDto,
  ) {
    return this.team.assign(user, id, dto);
  }
  @Delete('members/:userId') removeMember(
    @CurrentUser() user: JwtPayload,
    @Param('propertyId', ParseUUIDPipe) id: string,
    @Param('userId', ParseUUIDPipe) userId: string,
  ) {
    return this.team.removeMember(user, id, userId);
  }
}

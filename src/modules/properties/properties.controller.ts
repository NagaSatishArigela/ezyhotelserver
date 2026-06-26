import {
  Body,
  Controller,
  Get,
  Param,
  ParseIntPipe,
  ParseUUIDPipe,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { PropertyRole } from '@prisma/client';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { PropertyRoles } from '../auth/decorators/property-roles.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { PropertyRoleGuard } from '../auth/guards/property-role.guard';
import { JwtPayload } from '../auth/interfaces/jwt-payload.interface';
import {
  CreateDraftResult,
  DraftView,
  PropertiesService,
  SaveStepResult,
  StatusView,
  SubmitResult,
} from './properties.service';

@ApiTags('Properties')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('properties')
export class PropertiesController {
  constructor(private readonly propertiesService: PropertiesService) {}

  @ApiOperation({ summary: 'Create a new property onboarding draft' })
  @Post('draft')
  createDraft(@CurrentUser() user: JwtPayload): Promise<CreateDraftResult> {
    return this.propertiesService.createDraft(user.id);
  }

  @ApiOperation({ summary: 'Auto-save a wizard step (1-5) for a draft property' })
  @UseGuards(PropertyRoleGuard)
  @PropertyRoles(PropertyRole.OWNER)
  @Patch(':propertyId/step/:stepNum')
  saveStep(
    @Param('propertyId', ParseUUIDPipe) propertyId: string,
    @Param('stepNum', ParseIntPipe) stepNum: number,
    @Body() body: Record<string, unknown>,
  ): Promise<SaveStepResult> {
    return this.propertiesService.saveStep(propertyId, stepNum, body);
  }

  @ApiOperation({ summary: 'Get the current onboarding draft state' })
  @UseGuards(PropertyRoleGuard)
  @PropertyRoles(PropertyRole.OWNER)
  @Get(':propertyId/draft')
  getDraft(@Param('propertyId', ParseUUIDPipe) propertyId: string): Promise<DraftView> {
    return this.propertiesService.getDraft(propertyId);
  }

  @ApiOperation({ summary: 'Submit a draft property for review' })
  @UseGuards(PropertyRoleGuard)
  @PropertyRoles(PropertyRole.OWNER)
  @Post(':propertyId/submit')
  submit(@Param('propertyId', ParseUUIDPipe) propertyId: string): Promise<SubmitResult> {
    return this.propertiesService.submit(propertyId);
  }

  @ApiOperation({ summary: 'Get the submission status and review timeline' })
  @UseGuards(PropertyRoleGuard)
  @PropertyRoles(PropertyRole.OWNER)
  @Get(':propertyId/status')
  getStatus(@Param('propertyId', ParseUUIDPipe) propertyId: string): Promise<StatusView> {
    return this.propertiesService.getStatus(propertyId);
  }

  @ApiOperation({ summary: 'Resubmit a property after a requested revision' })
  @UseGuards(PropertyRoleGuard)
  @PropertyRoles(PropertyRole.OWNER)
  @Patch(':propertyId/revise')
  revise(@Param('propertyId', ParseUUIDPipe) propertyId: string): Promise<SubmitResult> {
    return this.propertiesService.revise(propertyId);
  }
}

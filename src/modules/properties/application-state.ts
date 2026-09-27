import { BadRequestException, Body, ConflictException, Controller, Get, Injectable, Param, ParseUUIDPipe, Patch, UseGuards, Header } from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';
import { PrismaService } from '../database/prisma.service';
import { EncryptionService } from '../../common/crypto/encryption.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { PropertyRoleGuard } from '../auth/guards/property-role.guard';
import { ApplicationAccess } from '../auth/property-permissions';

@Injectable()
export class ApplicationStateService {
  constructor(private readonly prisma: PrismaService, private readonly encryption: EncryptionService) {}
  async save(propertyId: string, body: unknown) {
    if (!body || typeof body !== 'object' || Array.isArray(body)) throw new BadRequestException('Invalid application data');
    for (const [step, value] of Object.entries(body)) {
      if (!/^[1-6]$/.test(step) || !value || typeof value !== 'object' || Array.isArray(value)) throw new BadRequestException('Invalid application step');
    }
    const json = JSON.stringify(body);
    if (Buffer.byteLength(json) > 128 * 1024) throw new BadRequestException('Application data is too large');
    const encrypted = JSON.stringify(this.encryption.encrypt(json));
    // Update just this JSON key, without replacing concurrently saved canonical steps.
    const count = await this.prisma.$executeRaw`
      UPDATE properties.properties
      SET draft_data = jsonb_set(COALESCE(NULLIF(draft_data, 'null'::jsonb), '{}'::jsonb), '{portalSnapshot}', ${encrypted}::jsonb),
          updated_at = NOW()
      WHERE id = ${propertyId}::uuid AND status::text IN ('draft', 'needs_revision')
    `;
    if (!count) throw new ConflictException('Application is no longer editable');
    return { saved: true };
  }
  async read(propertyId: string) {
    const property = await this.prisma.property.findUnique({ where: { id: propertyId }, select: { draftData: true } });
    const snapshot = (property?.draftData as Record<string, unknown> | null)?.portalSnapshot;
    return typeof snapshot === 'string' ? JSON.parse(this.encryption.decrypt(snapshot)) as Record<string, unknown> : {};
  }
}

@Controller('properties')
@UseGuards(JwtAuthGuard, PropertyRoleGuard)
@ApplicationAccess()
export class ApplicationStateController {
  constructor(private readonly state: ApplicationStateService) {}
  @Patch(':propertyId/application-state')
  @SkipThrottle({ strict: true })
  save(@Param('propertyId', ParseUUIDPipe) id: string, @Body() body: unknown) { return this.state.save(id, body); }
  @Get(':propertyId/application-state')
  @Header('Cache-Control', 'private, no-store')
  read(@Param('propertyId', ParseUUIDPipe) id: string) { return this.state.read(id); }
}

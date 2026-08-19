import { Injectable } from '@nestjs/common';
import { PrismaService } from '../database/prisma.service';

/**
 * Money configuration resolved from the PlatformSettings singleton.
 * commissionPct / tdsPct are stored as Prisma Decimal in the DB; this service
 * hands callers plain numbers so pricing/payout math stays in integer paise.
 */
export interface PlatformMoneyConfig {
  commissionPct: number;
  tdsPct: number;
  payoutDayOfWeek: number;
  cancellationWindowHours: number;
}

@Injectable()
export class PlatformConfigService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Read the PlatformSettings singleton, upserting defaults on first access so
   * commission/TDS are always available even before a super-admin edits them.
   */
  async getMoneyConfig(): Promise<PlatformMoneyConfig> {
    const s = await this.prisma.platformSettings.upsert({
      where: { id: 'singleton' },
      create: { id: 'singleton' },
      update: {},
    });
    return {
      commissionPct: Number(s.commissionPct),
      tdsPct: Number(s.tdsPct),
      payoutDayOfWeek: s.payoutDayOfWeek,
      cancellationWindowHours: s.cancellationWindowHours,
    };
  }

  /** Platform commission on a booking's base tariff, in integer paise. */
  commissionPaise(baseAmountPaise: number, commissionPct: number): number {
    return Math.round((baseAmountPaise * commissionPct) / 100);
  }
}

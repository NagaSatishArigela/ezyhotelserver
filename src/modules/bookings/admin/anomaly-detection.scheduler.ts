import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { AdminAnomaliesService } from './admin-anomalies.service';

/**
 * M5B spec §2.2: every 5 minutes, run the rule-based anomaly detection
 * engine (ANO-001, 002, 003, 004, 006, 007, 009, 010) against recent bookings.
 */
@Injectable()
export class AnomalyDetectionScheduler {
  private readonly logger = new Logger(AnomalyDetectionScheduler.name);

  constructor(private readonly anomalies: AdminAnomaliesService) {}

  @Cron(CronExpression.EVERY_5_MINUTES)
  async handleDetection(): Promise<void> {
    const count = await this.anomalies.runDetection();
    if (count > 0) this.logger.log(`Detected ${count} new anomal${count === 1 ? 'y' : 'ies'}.`);
  }
}

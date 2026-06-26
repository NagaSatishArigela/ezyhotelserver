import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { UsersRepository } from '../repositories/user.repository';
import { RedisService } from '../../redis/redis.service';

const LOCK_KEY = 'lock:session-cleanup';
// Slightly less than the 15-minute cron interval, so a stuck/long-running
// run can't permanently wedge the lock past the next scheduled tick.
const LOCK_TTL_MS = 14 * 60 * 1000;

@Injectable()
export class SessionCleanupService {
  private readonly logger = new Logger(SessionCleanupService.name);

  constructor(
    private readonly users: UsersRepository,
    private readonly redis: RedisService,
  ) {}

  @Cron('*/15 * * * *')
  async revokeExpiredSessions(): Promise<void> {
    // Multiple pods run this cron on the same schedule. Only one should do
    // the work per tick - acquire a Redis lock and skip if another pod
    // already holds it.
    const release = await this.redis.acquireLock(LOCK_KEY, LOCK_TTL_MS);
    if (!release) {
      this.logger.debug({ event: 'auth.sessions.cleanup_skipped_locked' });
      return;
    }

    try {
      const revokedCount = await this.users.revokeExpiredSessions();
      if (revokedCount > 0) {
        this.logger.log({
          event: 'auth.sessions.expired_revoked',
          revokedCount,
        });
      }
    } finally {
      await release();
    }
  }
}

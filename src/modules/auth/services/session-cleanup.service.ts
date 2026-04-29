import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { UsersRepository } from '../repositories/user.repository';

@Injectable()
export class SessionCleanupService {
  private readonly logger = new Logger(SessionCleanupService.name);

  constructor(private readonly users: UsersRepository) {}

  @Cron('*/15 * * * *')
  async revokeExpiredSessions(): Promise<void> {
    const revokedCount = await this.users.revokeExpiredSessions();
    if (revokedCount > 0) {
      this.logger.log({
        event: 'auth.sessions.expired_revoked',
        revokedCount,
      });
    }
  }
}

import { Logger } from '@nestjs/common';
import { readFileSync } from 'fs';
import { join } from 'path';
import { SessionCleanupService } from '../services/session-cleanup.service';

describe(SessionCleanupService.name, () => {
  const users = {
    revokeExpiredSessions: jest.fn(),
  };
  let service: SessionCleanupService;

  beforeAll(() => {
    jest.spyOn(Logger.prototype, 'log').mockImplementation();
  });

  beforeEach(() => {
    jest.clearAllMocks();
    service = new SessionCleanupService(users as any);
  });

  it('defines a scheduled cleanup handler with a Cron decorator', () => {
    const source = readFileSync(
      join(__dirname, '../services/session-cleanup.service.ts'),
      'utf8',
    );

    expect(source).toContain("@Cron('*/15 * * * *')");
  });

  it('calls repository cleanup and logs deletion count', async () => {
    users.revokeExpiredSessions.mockResolvedValue(4);

    await service.revokeExpiredSessions();

    expect(users.revokeExpiredSessions).toHaveBeenCalledTimes(1);
    expect(Logger.prototype.log).toHaveBeenCalledWith({
      event: 'auth.sessions.expired_revoked',
      revokedCount: 4,
    });
  });
});

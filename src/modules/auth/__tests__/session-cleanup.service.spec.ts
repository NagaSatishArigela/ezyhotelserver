import { Logger } from '@nestjs/common';
import { readFileSync } from 'fs';
import { join } from 'path';
import { SessionCleanupService } from '../services/session-cleanup.service';

describe(SessionCleanupService.name, () => {
  const users = {
    revokeExpiredSessions: jest.fn(),
  };
  const release = jest.fn();
  const redis = {
    acquireLock: jest.fn(),
  };
  let service: SessionCleanupService;

  beforeAll(() => {
    jest.spyOn(Logger.prototype, 'log').mockImplementation();
    jest.spyOn(Logger.prototype, 'debug').mockImplementation();
  });

  beforeEach(() => {
    jest.clearAllMocks();
    redis.acquireLock.mockResolvedValue(release);
    service = new SessionCleanupService(users as any, redis as any);
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
    expect(release).toHaveBeenCalledTimes(1);
  });

  it('skips cleanup when another instance already holds the lock', async () => {
    redis.acquireLock.mockResolvedValue(null);

    await service.revokeExpiredSessions();

    expect(users.revokeExpiredSessions).not.toHaveBeenCalled();
  });

  it('releases the lock even if cleanup throws', async () => {
    users.revokeExpiredSessions.mockRejectedValue(new Error('db down'));

    await expect(service.revokeExpiredSessions()).rejects.toThrow('db down');
    expect(release).toHaveBeenCalledTimes(1);
  });
});

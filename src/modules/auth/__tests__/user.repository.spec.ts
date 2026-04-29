import { UsersRepository } from '../repositories/user.repository';

describe(UsersRepository.name, () => {
  const sessionFindMany = jest.fn();
  const sessionUpdateMany = jest.fn();
  const prisma = {
    session: {
      findMany: sessionFindMany,
      updateMany: sessionUpdateMany,
    },
  } as any;

  let repository: UsersRepository;

  beforeEach(() => {
    jest.clearAllMocks();
    repository = new UsersRepository(prisma);
  });

  it('revokes only expired sessions and uses a bounded batch size', async () => {
    const now = new Date('2026-04-26T00:00:00.000Z');

    sessionFindMany
      .mockResolvedValueOnce([{ id: 'expired-session-1' }, { id: 'expired-session-2' }])
      .mockResolvedValueOnce([]);
    sessionUpdateMany.mockResolvedValue({ count: 2 });

    const count = await repository.revokeExpiredSessions(now, 2);

    expect(count).toBe(2);
    expect(sessionFindMany).toHaveBeenCalledTimes(2);
    expect(sessionFindMany).toHaveBeenCalledWith({
      where: {
        expiresAt: { lte: now },
        revokedAt: null,
      },
      select: { id: true },
      take: 2,
      orderBy: { id: 'asc' },
    });
    expect(sessionUpdateMany).toHaveBeenCalledWith({
      where: {
        id: { in: ['expired-session-1', 'expired-session-2'] },
        revokedAt: null,
      },
      data: { revokedAt: now },
    });
  });
});

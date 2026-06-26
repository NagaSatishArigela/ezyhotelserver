import { Inject, Injectable, OnModuleDestroy } from '@nestjs/common';
import Redis from 'ioredis';
import { REDIS_CLIENT } from './redis.constants';

@Injectable()
export class RedisService implements OnModuleDestroy {
  constructor(@Inject(REDIS_CLIENT) private readonly redis: Redis) {}

  get client(): Redis {
    return this.redis;
  }

  /**
   * Acquire a short-lived distributed lock (SET NX PX). Returns a release
   * function if the lock was acquired, or null if another holder already
   * has it. Used to ensure scheduled jobs (e.g. cron cleanup tasks) run on
   * only one pod/instance at a time.
   */
  async acquireLock(
    key: string,
    ttlMs: number,
  ): Promise<(() => Promise<void>) | null> {
    const token = `${process.pid}:${Date.now()}:${Math.random().toString(36).slice(2)}`;
    const result = await this.redis.set(key, token, 'PX', ttlMs, 'NX');
    if (result !== 'OK') {
      return null;
    }

    return async () => {
      // Only delete the lock if we still own it (avoid deleting a lock
      // acquired by someone else after our TTL expired).
      const releaseScript = `
        if redis.call('GET', KEYS[1]) == ARGV[1] then
          return redis.call('DEL', KEYS[1])
        end
        return 0
      `;
      await this.redis.eval(releaseScript, 1, key, token);
    };
  }

  async onModuleDestroy(): Promise<void> {
    await this.redis.quit();
  }
}

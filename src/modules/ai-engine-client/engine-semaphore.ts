import { Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type Redis from 'ioredis';
import { randomUUID } from 'node:crypto';

import { REDIS_CLIENT } from '@infra/redis/redis.module';
import type { PythonEngineConfig } from '@config/index';

const LOCK_TTL_MS = 200_000;

/**
 * Global serialization for heavy Python calls. BullMQ concurrency:1 is
 * per worker process; this SET NX PX lock is the second layer so even a
 * direct controller call cannot pile 12k-doc scans onto one uvicorn.
 *
 * Unlock is compare-and-delete (token match). A bare DEL would let a slow
 * holder delete a successor's lock.
 */
@Injectable()
export class EngineSemaphore {
  private readonly logger = new Logger(EngineSemaphore.name);
  private readonly prefix: string;

  constructor(
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
    config: ConfigService,
  ) {
    const engine = config.get<PythonEngineConfig>('pythonEngine')!;
    this.prefix = `engine:heavy:${engine.host}:${engine.port}`;
  }

  async withLock<T>(fn: () => Promise<T>): Promise<T> {
    const token = randomUUID();
    const key = `${this.prefix}:lock`;
    const started = Date.now();
    while (Date.now() - started < LOCK_TTL_MS) {
      const ok = await this.redis.set(key, token, 'PX', LOCK_TTL_MS, 'NX');
      if (ok === 'OK') {
        try {
          return await fn();
        } finally {
          await this.release(key, token);
        }
      }
      await new Promise((r) => setTimeout(r, 50));
    }
    this.logger.warn('timed out waiting for heavy-engine lock');
    throw new Error('engine-semaphore-timeout');
  }

  private async release(key: string, token: string): Promise<void> {
    const script = `
      if redis.call('GET', KEYS[1]) == ARGV[1] then
        return redis.call('DEL', KEYS[1])
      else
        return 0
      end
    `;
    const client = this.redis as Redis & {
      eval?: (s: string, n: number, ...rest: string[]) => Promise<unknown>;
    };
    if (typeof client.eval === 'function') {
      await client.eval(script, 1, key, token);
      return;
    }
    const current = await this.redis.get(key);
    if (current === token) await this.redis.del(key);
  }
}

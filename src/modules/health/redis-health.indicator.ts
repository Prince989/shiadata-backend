import { Inject, Injectable } from '@nestjs/common';
import { HealthIndicatorService } from '@nestjs/terminus';
import type Redis from 'ioredis';

import { REDIS_CLIENT } from '@infra/redis/redis.module';

@Injectable()
export class RedisHealthIndicator {
  constructor(
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
    private readonly healthIndicatorService: HealthIndicatorService,
  ) {}

  async check(key: string) {
    const indicator = this.healthIndicatorService.check(key);
    try {
      const pong = await Promise.race([
        this.redis.ping(),
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error('redis ping timed out')), 1000),
        ),
      ]);
      if (pong !== 'PONG') {
        // ioredis types ping()'s resolved value as the literal 'PONG', so TS
        // narrows this branch to `never` -- String() still handles whatever
        // a misbehaving server actually sent back at runtime.
        return indicator.down({
          message: `unexpected ping reply: ${String(pong)}`,
        });
      }
      return indicator.up();
    } catch (err) {
      return indicator.down({
        message: err instanceof Error ? err.message : String(err),
      });
    }
  }
}

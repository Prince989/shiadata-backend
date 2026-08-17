import { Inject, Injectable } from '@nestjs/common';
import type Redis from 'ioredis';

import { REDIS_CLIENT } from '@infra/redis/redis.module';
import {
  CachedLlmResponse,
  ILlmCache,
} from '../interfaces/llm-cache.interface';

@Injectable()
export class RedisLlmCache implements ILlmCache {
  constructor(@Inject(REDIS_CLIENT) private readonly redis: Redis) {}

  async get(key: string): Promise<CachedLlmResponse | null> {
    const raw = await this.redis.get(key);
    return raw ? (JSON.parse(raw) as CachedLlmResponse) : null;
  }

  async set(
    key: string,
    value: CachedLlmResponse,
    ttlSeconds: number,
  ): Promise<void> {
    await this.redis.set(key, JSON.stringify(value), 'EX', ttlSeconds);
  }

  async del(key: string): Promise<void> {
    await this.redis.del(key);
  }

  async tryLock(key: string, ttlMs: number): Promise<boolean> {
    const result = await this.redis.set(`${key}:lock`, '1', 'PX', ttlMs, 'NX');
    return result === 'OK';
  }

  async unlock(key: string): Promise<void> {
    await this.redis.del(`${key}:lock`);
  }
}

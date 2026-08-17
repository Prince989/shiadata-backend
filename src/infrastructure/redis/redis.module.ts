import { Global, Module, OnModuleDestroy, Inject } from '@nestjs/common';
import type Redis from 'ioredis';

import { redisProvider } from './redis.provider';
import { REDIS_CLIENT } from './redis.constants';

export { REDIS_CLIENT };

/**
 * @Global(): infrastructure, not domain. Every feature module needing Redis
 * (cache, throttler storage, BullMQ, the LLM key pool) would otherwise need
 * to re-import this -- unlike AiGatewayModule, there's no value in forcing
 * that repetition here.
 */
@Global()
@Module({
  providers: [redisProvider],
  exports: [redisProvider],
})
export class RedisModule implements OnModuleDestroy {
  constructor(@Inject(REDIS_CLIENT) private readonly client: Redis) {}

  async onModuleDestroy(): Promise<void> {
    await this.client.quit();
  }
}

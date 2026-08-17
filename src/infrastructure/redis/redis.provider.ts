import { Logger, Provider } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';

import { RedisConfig } from '@config/index';
import { REDIS_CLIENT } from './redis.constants';

export const redisProvider: Provider = {
  provide: REDIS_CLIENT,
  inject: [ConfigService],
  useFactory: (config: ConfigService): Redis => {
    const logger = new Logger('Redis');
    const redis = config.get<RedisConfig>('redis')!;

    const client = new Redis({
      host: redis.host,
      port: redis.port,
      password: redis.password || undefined,
      db: redis.db,
      tls: redis.tls ? {} : undefined,
      keyPrefix: redis.keyPrefix,
      // Keep reconnecting; a transient Redis outage should degrade features
      // (cache misses, no rate limiting) rather than crash the process.
      retryStrategy: (attempt: number) => Math.min(attempt * 200, 5000),
      maxRetriesPerRequest: 3,
    });

    client.on('error', (err) =>
      logger.error(`Redis client error: ${err.message}`),
    );
    client.on('connect', () =>
      logger.log(`Connected to redis at ${redis.host}:${redis.port}`),
    );

    return client;
  },
};

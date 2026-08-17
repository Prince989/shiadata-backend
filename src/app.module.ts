import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import { ThrottlerModule, ThrottlerStorage } from '@nestjs/throttler';
import { ThrottlerStorageRedisService } from '@nest-lab/throttler-storage-redis';
import type Redis from 'ioredis';

import {
  appConfig,
  mongoConfig,
  redisConfig,
  jwtConfig,
  pythonEngineConfig,
  throttlerConfig,
  llmConfig,
  envValidationSchema,
} from '@config/index';
import { ThrottlerConfig } from '@config/index';
import { DatabaseModule } from '@infra/database/database.module';
import { RedisModule, REDIS_CLIENT } from '@infra/redis/redis.module';
import { LoggerModule } from '@infra/logger/logger.module';
import { UserThrottlerGuard } from '@common/guards/user-throttler.guard';
import { HealthModule } from '@modules/health/health.module';
import { AiGatewayModule } from '@modules/ai-gateway/ai-gateway.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      cache: true,
      envFilePath: ['.env.local', '.env'],
      validationSchema: envValidationSchema,
      validationOptions: { abortEarly: false, allowUnknown: true },
      load: [
        appConfig,
        mongoConfig,
        redisConfig,
        jwtConfig,
        pythonEngineConfig,
        throttlerConfig,
        llmConfig,
      ],
    }),
    LoggerModule,
    RedisModule,
    DatabaseModule,
    ThrottlerModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService, REDIS_CLIENT],
      useFactory: (config: ConfigService, redis: Redis) => {
        const storage: ThrottlerStorage =
          config.get<ThrottlerConfig>('throttler')!.storage === 'redis'
            ? new ThrottlerStorageRedisService(redis)
            : undefined!; // undefined -> @nestjs/throttler's built-in in-memory storage

        return {
          storage,
          throttlers: [
            { name: 'short', ttl: 10_000, limit: 20 },
            { name: 'medium', ttl: 60_000, limit: 120 },
            { name: 'long', ttl: 3_600_000, limit: 1000 },
          ],
        };
      },
    }),
    HealthModule,
    AiGatewayModule,
  ],
  providers: [{ provide: APP_GUARD, useClass: UserThrottlerGuard }],
})
export class AppModule {}

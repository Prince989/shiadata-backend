import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { MongooseModule } from '@nestjs/mongoose';

import type { LlmConfig } from '@config/index';
import { LLM_CACHE } from './constants/ai-gateway.tokens';
import { LlmAdminController } from './controllers/llm-admin.controller';
import { LlmCallLog, LlmCallLogSchema } from './schemas/llm-call-log.schema';
import { AiGatewayService } from './services/ai-gateway.service';
import { CallLogService } from './services/call-log.service';
import { CostCalculatorService } from './services/cost-calculator.service';
import { KeyPoolService } from './services/key-pool.service';
import { LlmMetricsService } from './services/llm-metrics.service';
import { MemoryLlmCache } from './services/memory-llm-cache.service';
import { RedisLlmCache } from './services/redis-llm-cache.service';
import { StructuredOutputService } from './services/structured-output.service';
import { TokenBudgetService } from './services/token-budget.service';
import { GeminiProvider } from './providers/gemini.provider';
import { OpenAiProvider } from './providers/openai.provider';

/**
 * Deliberately NOT @Global(). This is the single most expensive dependency
 * in the system -- "every module injects it" is not a good reason to hide
 * it from the module graph. One import line per feature module is a fair
 * price for keeping it testable in isolation.
 */
@Module({
  imports: [
    ConfigModule,
    MongooseModule.forFeature([
      { name: LlmCallLog.name, schema: LlmCallLogSchema },
    ]),
  ],
  controllers: [LlmAdminController],
  providers: [
    KeyPoolService,
    GeminiProvider,
    OpenAiProvider,
    StructuredOutputService,
    TokenBudgetService,
    CostCalculatorService,
    LlmMetricsService,
    CallLogService,
    RedisLlmCache,
    MemoryLlmCache,
    {
      provide: LLM_CACHE,
      inject: [ConfigService, RedisLlmCache, MemoryLlmCache],
      useFactory: (
        config: ConfigService,
        redisCache: RedisLlmCache,
        memoryCache: MemoryLlmCache,
      ) => {
        const driver = config.get<LlmConfig>('llm')!.cacheDriver;
        return driver === 'redis' ? redisCache : memoryCache;
      },
    },
    AiGatewayService,
  ],
  exports: [AiGatewayService],
})
export class AiGatewayModule {}

import {
  Controller,
  Get,
  Query,
  UseGuards,
  Version,
  VERSION_NEUTRAL,
} from '@nestjs/common';

import { OpsTokenGuard } from '@common/guards/ops-token.guard';
import { KeyPoolService } from '../services/key-pool.service';
import { LlmMetricsService } from '../services/llm-metrics.service';
import { TokenBudgetService } from '../services/token-budget.service';

/**
 * Internal-only. Never exposes a secret -- key snapshots carry ids like
 * 'gemini#1', never the underlying value.
 */
@Controller('internal/llm')
@UseGuards(OpsTokenGuard)
export class LlmAdminController {
  constructor(
    private readonly keyPool: KeyPoolService,
    private readonly metrics: LlmMetricsService,
    private readonly tokenBudget: TokenBudgetService,
  ) {}

  @Get('keys')
  @Version(VERSION_NEUTRAL)
  async keys() {
    return this.keyPool.snapshot();
  }

  @Get('spend')
  @Version(VERSION_NEUTRAL)
  async spend(@Query('userId') userId?: string) {
    return this.tokenBudget.snapshot(userId);
  }

  @Get('metrics')
  @Version(VERSION_NEUTRAL)
  metrics_() {
    return this.metrics.snapshot();
  }
}

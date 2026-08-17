import { Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type Redis from 'ioredis';

import { REDIS_CLIENT } from '@infra/redis/redis.module';
import type { LlmConfig } from '@config/index';
import {
  LlmBudgetExceededError,
  LlmInputTooLargeError,
} from '../errors/llm.errors';

const SPEND_KEY_TTL_MS = 172_800_000; // 2 days -- outlives the UTC day it tracks

function todayUtc(): string {
  return new Date().toISOString().slice(0, 10);
}

function secondsUntilUtcMidnight(): number {
  const now = new Date();
  const midnight = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1),
  );
  return Math.ceil((midnight.getTime() - now.getTime()) / 1000);
}

export interface BudgetCheck {
  dailySpendUsd: number;
  userSpendUsd: number;
  userCalls: number;
}

/**
 * Three layers of protection, of which this owns two:
 *
 * Layer 2 (input guard): `max_tokens` caps OUTPUT only. This workload is
 * input-dominated -- a grand-ijtihad prompt carries several rijal documents
 * plus quran/shawahid context, easily 20-50k input tokens against a 2k
 * output cap. Reject oversized input BEFORE spending anything.
 *
 * Layer 3 (spend ledger): reserve-then-reconcile against Redis, using the
 * WORST-CASE cost (input estimate + full output ceiling) at reserve time.
 * This is what makes the cap hold under concurrency -- charging only after
 * the call completes would let 20 parallel requests all pass the check
 * before any of them registers, together blowing straight through the cap.
 * Redis is the enforcement point; the durable Mongo log (CallLogService)
 * is the record of truth, written off this hot path.
 */
@Injectable()
export class TokenBudgetService {
  private readonly config: LlmConfig;

  constructor(
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
    configService: ConfigService,
  ) {
    this.config = configService.get<LlmConfig>('llm')!;
  }

  estimateInputTokens(text: string): number {
    return Math.ceil(text.length / this.config.inputCharsPerToken);
  }

  assertInputWithinLimit(text: string): void {
    const tokens = this.estimateInputTokens(text);
    if (tokens > this.config.maxInputTokens) {
      throw new LlmInputTooLargeError(
        'Estimated input size exceeds the configured limit',
        {
          estimatedTokens: tokens,
          limit: this.config.maxInputTokens,
        },
      );
    }
  }

  /**
   * Reserves `estimatedCostUsd` against the day/feature/user counters.
   * Throws LlmBudgetExceededError (refunding the reservation first) if any
   * cap would be exceeded. Callers MUST call `reconcile` afterwards with the
   * delta between estimated and actual cost, whether the call succeeded or
   * failed with partial usage.
   */
  async reserve(
    estimatedCostUsd: number,
    feature: string,
    userId?: string,
  ): Promise<void> {
    if (!this.config.budgetEnforce) return;

    const day = todayUtc();
    const dayKey = `aigw:spend:day:${day}`;
    const featureKey = `aigw:spend:feature:${feature}:${day}`;
    const userSpendKey = userId ? `aigw:spend:user:${userId}:${day}` : null;
    const userCallsKey = userId ? `aigw:calls:user:${userId}:${day}` : null;

    const dailySpendUsd = await this.incrByFloat(dayKey, estimatedCostUsd);
    await this.incrByFloat(featureKey, estimatedCostUsd);
    const userSpendUsd = userSpendKey
      ? await this.incrByFloat(userSpendKey, estimatedCostUsd)
      : 0;
    const userCalls = userCallsKey ? await this.incrInt(userCallsKey, 1) : 0;

    const overDaily = dailySpendUsd > this.config.dailyBudgetUsd;
    const overUserSpend =
      !!userId && userSpendUsd > this.config.userDailyBudgetUsd;
    const overUserCalls =
      !!userId && userCalls > this.config.userDailyCallLimit;

    if (overDaily || overUserSpend || overUserCalls) {
      // Refund everything just reserved before throwing.
      await this.incrByFloat(dayKey, -estimatedCostUsd);
      await this.incrByFloat(featureKey, -estimatedCostUsd);
      if (userSpendKey) await this.incrByFloat(userSpendKey, -estimatedCostUsd);
      if (userCallsKey) await this.incrInt(userCallsKey, -1);

      throw new LlmBudgetExceededError(secondsUntilUtcMidnight(), {
        feature,
        userId,
        dailySpendUsd,
        userSpendUsd,
        userCalls,
        overDaily,
        overUserSpend,
        overUserCalls,
      });
    }
  }

  /** Adjusts the ledger by the difference between actual and reserved cost. */
  async reconcile(
    deltaUsd: number,
    feature: string,
    userId?: string,
  ): Promise<void> {
    if (!this.config.budgetEnforce || deltaUsd === 0) return;

    const day = todayUtc();
    await this.incrByFloat(`aigw:spend:day:${day}`, deltaUsd);
    await this.incrByFloat(`aigw:spend:feature:${feature}:${day}`, deltaUsd);
    if (userId)
      await this.incrByFloat(`aigw:spend:user:${userId}:${day}`, deltaUsd);
  }

  async snapshot(userId?: string): Promise<BudgetCheck> {
    const day = todayUtc();
    const dailySpendUsd = Number(
      (await this.redis.get(`aigw:spend:day:${day}`)) ?? 0,
    );
    const userSpendUsd = userId
      ? Number((await this.redis.get(`aigw:spend:user:${userId}:${day}`)) ?? 0)
      : 0;
    const userCalls = userId
      ? Number((await this.redis.get(`aigw:calls:user:${userId}:${day}`)) ?? 0)
      : 0;
    return { dailySpendUsd, userSpendUsd, userCalls };
  }

  private async incrByFloat(key: string, delta: number): Promise<number> {
    const result = await this.redis.incrbyfloat(key, delta);
    await this.redis.pexpire(key, SPEND_KEY_TTL_MS);
    return Number(result);
  }

  private async incrInt(key: string, delta: number): Promise<number> {
    const result =
      delta >= 0
        ? await this.redis.incrby(key, delta)
        : await this.redis.decrby(key, -delta);
    await this.redis.pexpire(key, SPEND_KEY_TTL_MS);
    return result;
  }
}

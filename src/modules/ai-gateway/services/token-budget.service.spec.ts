import { ConfigService } from '@nestjs/config';

import { FakeRedis } from '@/test-utils/fake-redis';
import { testLlmConfig } from '@/test-utils/llm-config.fixture';
import { LlmBudgetExceededError, LlmInputTooLargeError } from '../errors/llm.errors';
import { TokenBudgetService } from './token-budget.service';

function buildBudget(redis: FakeRedis, overrides = {}) {
  const config = {
    get: () => testLlmConfig(overrides),
  } as unknown as ConfigService;
  return new TokenBudgetService(redis as never, config);
}

describe('TokenBudgetService', () => {
  it('rejects oversized Arabic-heavy input before any spend', () => {
    const budget = buildBudget(new FakeRedis(), { maxInputTokens: 10 });
    expect(() => budget.assertInputWithinLimit('ا'.repeat(100))).toThrow(
      LlmInputTooLargeError,
    );
  });

  it('rejects a reserve that would exceed the daily cap and refunds', async () => {
    const redis = new FakeRedis();
    const budget = buildBudget(redis, { dailyBudgetUsd: 1, userDailyBudgetUsd: 10 });

    await budget.reserve(0.6, 'ijtihad', 'user-1');
    await expect(budget.reserve(0.6, 'ijtihad', 'user-1')).rejects.toBeInstanceOf(
      LlmBudgetExceededError,
    );

    const snap = await budget.snapshot('user-1');
    expect(snap.dailySpendUsd).toBeCloseTo(0.6);
    expect(snap.userCalls).toBe(1);
  });

  it('holds the cap under concurrent reserves', async () => {
    const redis = new FakeRedis();
    const budget = buildBudget(redis, {
      dailyBudgetUsd: 1,
      userDailyBudgetUsd: 10,
      userDailyCallLimit: 100,
    });

    const results = await Promise.allSettled(
      Array.from({ length: 20 }, () => budget.reserve(0.2, 'ijtihad', 'u')),
    );
    const accepted = results.filter((r) => r.status === 'fulfilled').length;
    const rejected = results.filter((r) => r.status === 'rejected').length;
    expect(accepted).toBeLessThanOrEqual(5);
    expect(accepted + rejected).toBe(20);

    const snap = await budget.snapshot('u');
    expect(snap.dailySpendUsd).toBeLessThanOrEqual(1.05);
  });
});

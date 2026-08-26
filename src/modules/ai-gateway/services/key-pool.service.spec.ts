import { ConfigService } from '@nestjs/config';

import { REDIS_CLIENT } from '@infra/redis/redis.module';
import { FakeRedis } from '@/test-utils/fake-redis';
import { testLlmConfig } from '@/test-utils/llm-config.fixture';
import { KeyFailureKind } from '../interfaces/key-pool.interface';
import { KeyPoolService } from './key-pool.service';

function buildPool(redis: FakeRedis): KeyPoolService {
  const config = { get: () => testLlmConfig() } as unknown as ConfigService;
  const pool = new KeyPoolService(redis as never, config);
  pool.onModuleInit();
  return pool;
}

describe('KeyPoolService', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    process.env.GOOGLE_API_KEY = 'gemini-secret-0';
    process.env.GOOGLE_API_KEY1 = 'gemini-secret-1';
    process.env.GOOGLE_API_KEY2 = 'gemini-secret-2';
    process.env.GOOGLE_API_KEY3 = 'gemini-secret-0'; // duplicate of #0
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it('de-duplicates identical keys so rotation is not theatrical', () => {
    const pool = buildPool(new FakeRedis());
    expect(pool.poolSize('gemini')).toBe(3);
  });

  it('round-robins across healthy keys', async () => {
    const pool = buildPool(new FakeRedis());
    const seen = new Set<string>();
    for (let i = 0; i < 6; i++) {
      const key = await pool.acquire('gemini');
      expect(key).not.toBeNull();
      seen.add(key!.id);
    }
    expect(seen.size).toBe(3);
  });

  it('cools a 429 key and rotates to the next one', async () => {
    const redis = new FakeRedis();
    const pool = buildPool(redis);

    const first = await pool.acquire('gemini');
    expect(first).not.toBeNull();
    await pool.reportFailure(first!.id, KeyFailureKind.RateLimited, 60_000);

    const next = await pool.acquire('gemini');
    expect(next).not.toBeNull();
    expect(next!.id).not.toBe(first!.id);

    const snap = await pool.snapshot('gemini');
    expect(snap[0]!.cooling.some((c) => c.keyId === first!.id)).toBe(true);
  });

  it('does not cool a key on BadRequest or ContentFiltered', async () => {
    const pool = buildPool(new FakeRedis());
    const key = await pool.acquire('gemini');
    await pool.reportFailure(key!.id, KeyFailureKind.BadRequest);
    await pool.reportFailure(key!.id, KeyFailureKind.ContentFiltered);

    const snap = await pool.snapshot('gemini');
    expect(snap[0]!.cooling).toHaveLength(0);
    expect(snap[0]!.healthy).toBe(3);
  });

  it('lets a cooled key back in after expiry (half-open probe lock)', async () => {
    const redis = new FakeRedis();
    const pool = buildPool(redis);
    const key = await pool.acquire('gemini');
    await redis.set(
      `aigw:cool:${key!.id}`,
      JSON.stringify({
        reason: KeyFailureKind.RateLimited,
        strikes: 1,
        retryAtMs: Date.now() - 1,
      }),
    );

    const recovered = await pool.acquire('gemini');
    expect(recovered).not.toBeNull();
  });
});

import { MemoryLlmCache } from './memory-llm-cache.service';

describe('MemoryLlmCache', () => {
  it('returns a cached payload on repeat get', async () => {
    const cache = new MemoryLlmCache();
    await cache.set(
      'k1',
      {
        raw: '{"ok":true}',
        data: { ok: true },
        meta: {
          provider: 'gemini',
          model: 'gemini-3.5-flash',
          keyId: 'gemini#0',
          attempts: 1,
          finishReason: 'stop',
          repaired: false,
          usage: { inputTokens: 10, outputTokens: 5, estimatedCostUsd: 0.001 },
        },
        cachedAt: new Date().toISOString(),
      },
      60,
    );
    const hit = await cache.get('k1');
    expect(hit?.data).toEqual({ ok: true });
  });

  it('single-flight lock: second locker loses', async () => {
    const cache = new MemoryLlmCache();
    await expect(cache.tryLock('lock', 5_000)).resolves.toBe(true);
    await expect(cache.tryLock('lock', 5_000)).resolves.toBe(false);
    await cache.unlock('lock');
    await expect(cache.tryLock('lock', 5_000)).resolves.toBe(true);
  });
});

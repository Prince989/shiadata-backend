import { Injectable } from '@nestjs/common';

import { CachedLlmResponse, ILlmCache } from '../interfaces/llm-cache.interface';

interface Entry {
  value: CachedLlmResponse;
  expiresAt: number;
}

/**
 * Single-process fallback so LLM_CACHE_DRIVER=memory (or a Redis outage,
 * once wired to fall back) doesn't require a second infrastructure
 * dependency for local dev or tests. Not shared across replicas -- do not
 * use in a multi-instance deployment expecting cross-replica cache hits.
 */
@Injectable()
export class MemoryLlmCache implements ILlmCache {
  private store = new Map<string, Entry>();
  private locks = new Set<string>();

  get(key: string): Promise<CachedLlmResponse | null> {
    const entry = this.store.get(key);
    if (!entry) return Promise.resolve(null);
    if (entry.expiresAt < Date.now()) {
      this.store.delete(key);
      return Promise.resolve(null);
    }
    return Promise.resolve(entry.value);
  }

  set(key: string, value: CachedLlmResponse, ttlSeconds: number): Promise<void> {
    this.store.set(key, { value, expiresAt: Date.now() + ttlSeconds * 1000 });
    return Promise.resolve();
  }

  del(key: string): Promise<void> {
    this.store.delete(key);
    return Promise.resolve();
  }

  tryLock(key: string, ttlMs: number): Promise<boolean> {
    if (this.locks.has(key)) return Promise.resolve(false);
    this.locks.add(key);
    const timer = setTimeout(() => this.locks.delete(key), ttlMs);
    timer.unref();
    return Promise.resolve(true);
  }

  unlock(key: string): Promise<void> {
    this.locks.delete(key);
    return Promise.resolve();
  }
}

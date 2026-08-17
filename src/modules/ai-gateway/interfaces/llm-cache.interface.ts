import type { LlmCallMeta } from './llm-request.interface';

export interface CachedLlmResponse {
  raw: string;
  /** Pre-parsed; re-validated with the caller's Zod schema on read. */
  data: unknown;
  meta: Omit<LlmCallMeta, 'cache' | 'latencyMs'>;
  cachedAt: string;
}

export interface ILlmCache {
  get(key: string): Promise<CachedLlmResponse | null>;
  set(key: string, value: CachedLlmResponse, ttlSeconds: number): Promise<void>;
  del(key: string): Promise<void>;
  /** Cross-replica single-flight. Returns false if another caller holds the lock. */
  tryLock(key: string, ttlMs: number): Promise<boolean>;
  unlock(key: string): Promise<void>;
}

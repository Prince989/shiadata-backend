import type { ZodType } from 'zod';
import type { ProviderName } from '@config/index';

export interface LlmRequestBase {
  prompt: string;
  system?: string;
  /** Explicit model id, or omit to use the configured default. */
  model?: string;
  temperature?: number;
  maxOutputTokens?: number;
  /** Per-attempt timeout, ms. */
  timeoutMs?: number;
  /** Wall-clock budget across ALL attempts, ms. */
  deadlineMs?: number;
  thinkingBudget?: number;
  cache?: { enabled?: boolean; ttlSeconds?: number; namespace?: string };
  /**
   * Required, not optional: every LLM call must be attributable to a
   * product feature (and optionally a user) in the spend ledger, or the
   * daily bill has no owner.
   */
  budget: { feature: string; userId?: string };
  /**
   * Default true for cheap utility calls. Set false for scholarly-output
   * paths (ijtihad-style verdicts) where silently answering with a
   * different model/quality is worse than failing loudly.
   */
  allowProviderFallback?: boolean;
  traceId?: string;
  signal?: AbortSignal;
}

export interface StructuredLlmRequest<T> extends LlmRequestBase {
  schema: ZodType<T>;
  /** Stable name -> stable cache key. Must not change when the schema's shape doesn't. */
  schemaName: string;
  /** Default 1, max 2. */
  repairAttempts?: number;
}

export interface LlmCallMeta {
  provider: ProviderName;
  model: string;
  keyId: string;
  attempts: number;
  cache: 'hit' | 'miss' | 'bypass';
  latencyMs: number;
  finishReason: string;
  repaired: boolean;
  usage: {
    inputTokens: number;
    outputTokens: number;
    estimatedCostUsd: number;
  };
}

export interface LlmResult<T> {
  data: T;
  raw: string;
  meta: LlmCallMeta;
}

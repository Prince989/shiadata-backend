import type { ProviderName } from '@config/index';

export interface LlmKey {
  /** e.g. 'gemini#1' -- what gets logged. The secret itself never is. */
  readonly id: string;
  readonly provider: ProviderName;
  readonly index: number;
  readonly secret: string;
}

export enum KeyFailureKind {
  RateLimited = 'rate_limited',
  QuotaExhausted = 'quota_exhausted',
  AuthInvalid = 'auth_invalid',
  Timeout = 'timeout',
  ServerError = 'server_error',
  /** Our fault (bad schema/prompt) -- never rotate or retry on this. */
  BadRequest = 'bad_request',
  /** Provider safety block -- never rotate or retry on this. */
  ContentFiltered = 'content_filtered',
  Malformed = 'malformed',
}

export interface CoolingKey {
  keyId: string;
  reason: KeyFailureKind;
  retryAtIso: string;
}

export interface KeyPoolSnapshot {
  provider: ProviderName;
  total: number;
  healthy: number;
  cooling: CoolingKey[];
  disabled: string[];
}

export interface IKeyPool {
  /** Next healthy key, round-robin. null if every key for the provider is cooling. */
  acquire(provider: ProviderName): Promise<LlmKey | null>;
  reportSuccess(keyId: string): Promise<void>;
  reportFailure(
    keyId: string,
    kind: KeyFailureKind,
    retryAfterMs?: number,
  ): Promise<void>;
  snapshot(provider?: ProviderName): Promise<KeyPoolSnapshot[]>;
  poolSize(provider: ProviderName): number;
}

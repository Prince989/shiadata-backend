import type { LlmKey, KeyFailureKind } from './key-pool.interface';
import type { ProviderName } from '@config/index';

/** JSON Schema object, already narrowed to what our two providers accept. */
export type JsonSchemaObject = Record<string, unknown>;

export interface ProviderRequest {
  model: string;
  system?: string;
  prompt: string;
  temperature: number;
  maxOutputTokens: number;
  jsonSchema?: JsonSchemaObject;
  schemaName?: string;
  thinkingBudget?: number;
}

export interface ProviderResponse {
  text: string;
  finishReason: 'stop' | 'max_tokens' | 'safety' | 'other';
  usage: { inputTokens: number; outputTokens: number };
  modelUsed: string;
}

export interface LlmProvider {
  readonly name: ProviderName;
  readonly supportsNativeJsonSchema: boolean;

  /** Provider-specific JSON Schema dialect fixups (see each provider's own notes). */
  normalizeSchema(schema: JsonSchemaObject): JsonSchemaObject;

  generate(
    req: ProviderRequest,
    key: LlmKey,
    signal: AbortSignal,
  ): Promise<ProviderResponse>;

  /** Classify a thrown error into the shared failure taxonomy the key pool acts on. */
  classifyError(err: unknown): KeyFailureKind;

  /** Extract a provider-supplied Retry-After, if any, in milliseconds. */
  extractRetryAfterMs(err: unknown): number | undefined;
}

import { Injectable, Logger } from '@nestjs/common';
import { ApiError, FinishReason, GoogleGenAI } from '@google/genai';

import { KeyFailureKind } from '../interfaces/key-pool.interface';
import {
  JsonSchemaObject,
  LlmProvider,
  ProviderRequest,
  ProviderResponse,
} from '../interfaces/llm-provider.interface';

/**
 * Marker for a successful-looking response the model actually refused to
 * complete on safety grounds. @google/genai does not throw for this -- it
 * returns FinishReason.SAFETY with little or no text. Throwing our own error
 * here lets classifyError() handle it through the same single path as every
 * other failure, instead of the caller having to branch on
 * "success, but actually not" in two different places.
 */
class GeminiContentFilteredError extends Error {}

@Injectable()
export class GeminiProvider implements LlmProvider {
  readonly name = 'gemini' as const;
  readonly supportsNativeJsonSchema = true;

  private readonly logger = new Logger(GeminiProvider.name);
  private readonly clients = new Map<string, GoogleGenAI>();

  private clientFor(apiKey: string): GoogleGenAI {
    let client = this.clients.get(apiKey);
    if (!client) {
      client = new GoogleGenAI({ apiKey });
      this.clients.set(apiKey, client);
    }
    return client;
  }

  /**
   * Gemini's responseJsonSchema accepts a real subset of JSON Schema
   * ($id, $defs, $ref, type, format, enum, items, properties,
   * additionalProperties, required, anyOf, ...) but ignores `default` and is
   * picky about deeply nested $ref -- Zod's output is already close enough
   * that no rewriting is needed today. Kept as an explicit pass-through
   * (rather than deleting the method) so a future schema that hits an
   * unsupported construct has one place to patch.
   */
  normalizeSchema(schema: JsonSchemaObject): JsonSchemaObject {
    return schema;
  }

  async generate(
    req: ProviderRequest,
    key: { secret: string },
    signal: AbortSignal,
  ): Promise<ProviderResponse> {
    const client = this.clientFor(key.secret);

    try {
      const response = await client.models.generateContent({
        model: req.model,
        contents: req.prompt,
        config: {
          abortSignal: signal,
          systemInstruction: req.system,
          temperature: req.temperature,
          maxOutputTokens: req.maxOutputTokens,
          ...(req.jsonSchema
            ? {
                responseMimeType: 'application/json',
                responseJsonSchema: req.jsonSchema,
              }
            : {}),
          ...(req.thinkingBudget !== undefined
            ? { thinkingConfig: { thinkingBudget: req.thinkingBudget } }
            : {}),
        },
      });

      const candidate = response.candidates?.[0];
      if (candidate?.finishReason === FinishReason.SAFETY) {
        throw new GeminiContentFilteredError(
          'Content blocked by Gemini safety filters',
        );
      }

      const usage = response.usageMetadata;
      return {
        text: response.text ?? '',
        finishReason: this.mapFinishReason(candidate?.finishReason),
        usage: {
          inputTokens: usage?.promptTokenCount ?? 0,
          outputTokens: usage?.candidatesTokenCount ?? 0,
        },
        modelUsed: req.model,
      };
    } catch (err) {
      this.logger.debug(
        `Gemini call failed on key ${key.secret.slice(0, 6)}...: ${String(err)}`,
      );
      throw err;
    }
  }

  classifyError(err: unknown): KeyFailureKind {
    if (err instanceof GeminiContentFilteredError) {
      return KeyFailureKind.ContentFiltered;
    }

    if (err instanceof ApiError) {
      const message = err.message.toLowerCase();
      if (err.status === 429) {
        return message.includes('quota')
          ? KeyFailureKind.QuotaExhausted
          : KeyFailureKind.RateLimited;
      }
      if (err.status === 401 || err.status === 403)
        return KeyFailureKind.AuthInvalid;
      if (err.status === 400) return KeyFailureKind.BadRequest;
      if (err.status >= 500) return KeyFailureKind.ServerError;
    }

    if (err instanceof Error && /timeout|aborted/i.test(err.message)) {
      return KeyFailureKind.Timeout;
    }

    return KeyFailureKind.ServerError;
  }

  extractRetryAfterMs(err: unknown): number | undefined {
    if (err instanceof ApiError) {
      const match = /retry.{0,20}?(\d+)\s*s/i.exec(err.message);
      if (match) return Number(match[1]) * 1000;
    }
    return undefined;
  }

  private mapFinishReason(
    reason: FinishReason | undefined,
  ): ProviderResponse['finishReason'] {
    switch (reason) {
      case FinishReason.STOP:
        return 'stop';
      case FinishReason.MAX_TOKENS:
        return 'max_tokens';
      case FinishReason.SAFETY:
        return 'safety';
      default:
        return 'other';
    }
  }
}

import { Injectable, Logger } from '@nestjs/common';
import OpenAI from 'openai';
import type { ChatCompletionMessageParam } from 'openai/resources/chat/completions';

import { KeyFailureKind } from '../interfaces/key-pool.interface';
import {
  JsonSchemaObject,
  LlmProvider,
  ProviderRequest,
  ProviderResponse,
} from '../interfaces/llm-provider.interface';

@Injectable()
export class OpenAiProvider implements LlmProvider {
  readonly name = 'openai' as const;
  readonly supportsNativeJsonSchema = true;

  private readonly logger = new Logger(OpenAiProvider.name);
  private readonly clients = new Map<string, OpenAI>();

  private clientFor(apiKey: string): OpenAI {
    let client = this.clients.get(apiKey);
    if (!client) {
      // maxRetries: 0 is essential -- the SDK's own retry loop would retry
      // against the SAME key with no cooldown, silently bypassing key
      // rotation, the outer deadline, and spend accounting for every
      // retried attempt.
      client = new OpenAI({ apiKey, maxRetries: 0 });
      this.clients.set(apiKey, client);
    }
    return client;
  }

  /**
   * OpenAI's strict structured-output mode is considerably stricter than
   * Gemini's: every property in `properties` must be listed in `required`
   * (optional fields become nullable unions instead), and every object needs
   * `additionalProperties: false`. Zod 4's z.toJSONSchema() already emits
   * schemas close to this shape for object types with no optional fields;
   * this pass makes it exact so `strict: true` doesn't reject a schema that
   * validates fine on the Gemini path.
   */
  normalizeSchema(schema: JsonSchemaObject): JsonSchemaObject {
    return this.enforceStrict(schema) as JsonSchemaObject;
  }

  private enforceStrict(node: unknown): unknown {
    if (Array.isArray(node)) return node.map((n) => this.enforceStrict(n));
    if (typeof node !== 'object' || node === null) return node;

    const obj = { ...(node as Record<string, unknown>) };
    for (const key of Object.keys(obj)) {
      obj[key] = this.enforceStrict(obj[key]);
    }

    if (
      obj.type === 'object' &&
      obj.properties &&
      typeof obj.properties === 'object'
    ) {
      const propertyNames = Object.keys(obj.properties);
      obj.required = propertyNames;
      obj.additionalProperties = false;
    }

    return obj;
  }

  async generate(
    req: ProviderRequest,
    key: { secret: string },
    signal: AbortSignal,
  ): Promise<ProviderResponse> {
    const client = this.clientFor(key.secret);

    const messages: ChatCompletionMessageParam[] = [];
    if (req.system) messages.push({ role: 'system', content: req.system });
    messages.push({ role: 'user', content: req.prompt });

    try {
      const completion = await client.chat.completions.create(
        {
          model: req.model,
          messages,
          temperature: req.temperature,
          max_completion_tokens: req.maxOutputTokens,
          ...(req.jsonSchema
            ? {
                response_format: {
                  type: 'json_schema',
                  json_schema: {
                    name: req.schemaName ?? 'response',
                    schema: req.jsonSchema,
                    strict: true,
                  },
                },
              }
            : {}),
        },
        { signal },
      );

      const choice = completion.choices[0];
      return {
        text: choice?.message.content ?? '',
        finishReason: this.mapFinishReason(choice?.finish_reason),
        usage: {
          inputTokens: completion.usage?.prompt_tokens ?? 0,
          outputTokens: completion.usage?.completion_tokens ?? 0,
        },
        modelUsed: completion.model,
      };
    } catch (err) {
      this.logger.debug(
        `OpenAI call failed on key ${key.secret.slice(0, 6)}...: ${String(err)}`,
      );
      throw err;
    }
  }

  classifyError(err: unknown): KeyFailureKind {
    if (err instanceof OpenAI.APIUserAbortError) return KeyFailureKind.Timeout;
    if (err instanceof OpenAI.RateLimitError) {
      const message = err.message.toLowerCase();
      return message.includes('quota')
        ? KeyFailureKind.QuotaExhausted
        : KeyFailureKind.RateLimited;
    }
    if (
      err instanceof OpenAI.AuthenticationError ||
      err instanceof OpenAI.PermissionDeniedError
    ) {
      return KeyFailureKind.AuthInvalid;
    }
    if (
      err instanceof OpenAI.BadRequestError ||
      err instanceof OpenAI.UnprocessableEntityError
    ) {
      return KeyFailureKind.BadRequest;
    }
    if (err instanceof OpenAI.InternalServerError)
      return KeyFailureKind.ServerError;
    if (err instanceof OpenAI.APIConnectionTimeoutError)
      return KeyFailureKind.Timeout;
    if (err instanceof OpenAI.APIConnectionError)
      return KeyFailureKind.ServerError;
    return KeyFailureKind.ServerError;
  }

  extractRetryAfterMs(err: unknown): number | undefined {
    if (err instanceof OpenAI.APIError) {
      // `Headers` isn't in scope without the DOM lib; treat it as the
      // minimal fetch-style interface we actually need instead of pulling
      // in browser globals for one optional header read.
      const headers = err.headers as { get?: (name: string) => string | null } | undefined;
      const header = headers?.get?.('retry-after');
      if (header) return Number(header) * 1000;
    }
    return undefined;
  }

  private mapFinishReason(
    reason: string | null | undefined,
  ): ProviderResponse['finishReason'] {
    switch (reason) {
      case 'stop':
        return 'stop';
      case 'length':
        return 'max_tokens';
      case 'content_filter':
        return 'safety';
      default:
        return 'other';
    }
  }
}

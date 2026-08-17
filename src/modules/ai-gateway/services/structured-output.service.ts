import { Injectable, Logger } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { z, type ZodType } from 'zod';

import { repairJsonString } from '@common/utils/json-repair';
import { JsonSchemaObject } from '../interfaces/llm-provider.interface';

export type StructuredParseOutcome<T> =
  | { status: 'ok'; data: T; repaired: boolean }
  | { status: 'truncated' }
  | { status: 'needs_repair'; repairPrompt: string }
  | { status: 'failed' };

/**
 * Owns the "raw text -> validated object" half of structured output. Makes
 * no LLM calls itself -- the one LLM repair round-trip this can request is
 * driven by AiGatewayService, which already owns key selection and the
 * attempt/deadline loop. Keeping this service call-free makes it trivial to
 * unit test the parse/repair DECISION in isolation from any network.
 */
@Injectable()
export class StructuredOutputService {
  private readonly logger = new Logger(StructuredOutputService.name);
  private readonly schemaCache = new Map<string, JsonSchemaObject>();

  /** Cached by schemaName: converting the same ZodType repeatedly is pure waste. */
  toJsonSchema(schema: ZodType, schemaName: string): JsonSchemaObject {
    const cached = this.schemaCache.get(schemaName);
    if (cached) return cached;

    const converted = z.toJSONSchema(schema, {
      target: 'draft-7',
    }) as JsonSchemaObject;
    this.schemaCache.set(schemaName, converted);
    return converted;
  }

  schemaHash(schema: JsonSchemaObject): string {
    return createHash('sha256')
      .update(JSON.stringify(schema))
      .digest('hex')
      .slice(0, 16);
  }

  /**
   * Stage order matters:
   *  1. Truncation check FIRST -- if finishReason is max_tokens, the JSON is
   *     truncated, not malformed. A repair prompt would be money spent
   *     re-deriving text we already know is incomplete.
   *  2. Direct parse.
   *  3. Deterministic repair (fences, trailing commas, smart quotes) -- free.
   *  4. Signal that an LLM repair round-trip is warranted; the caller
   *     decides whether repairAttempts budget allows it.
   */
  parse<T>(
    raw: string,
    schema: ZodType<T>,
    finishReason: 'stop' | 'max_tokens' | 'safety' | 'other',
  ): StructuredParseOutcome<T> {
    if (finishReason === 'max_tokens') {
      return { status: 'truncated' };
    }

    const direct = this.tryParse(raw, schema);
    if (direct) return { status: 'ok', data: direct, repaired: false };

    const repairedText = repairJsonString(raw);
    if (repairedText !== raw.trim()) {
      const repaired = this.tryParse(repairedText, schema);
      if (repaired) return { status: 'ok', data: repaired, repaired: true };
    }

    return {
      status: 'needs_repair',
      repairPrompt: this.buildRepairPrompt(raw, schema),
    };
  }

  /** Re-validates a repaired LLM response against the original schema. */
  parseRepairAttempt<T>(raw: string): { data: unknown } | { error: string } {
    try {
      return { data: JSON.parse(raw) };
    } catch {
      const repaired = repairJsonString(raw);
      try {
        return { data: JSON.parse(repaired) };
      } catch (err) {
        return { error: err instanceof Error ? err.message : String(err) };
      }
    }
  }

  private tryParse<T>(text: string, schema: ZodType<T>): T | null {
    let candidate: unknown;
    try {
      candidate = JSON.parse(text);
    } catch {
      return null;
    }

    const result = schema.safeParse(candidate);
    if (!result.success) {
      this.logger.debug(
        `schema violation: ${result.error.issues.length} issue(s)`,
      );
      return null;
    }
    return result.data;
  }

  /**
   * Minimal by design: schema + bad output + Zod issues only, never the
   * original prompt. Resending the original prompt would double the input
   * cost on the most expensive calls this system makes.
   */
  private buildRepairPrompt(raw: string, schema: ZodType): string {
    const jsonSchema = z.toJSONSchema(schema, { target: 'draft-7' });
    let issues = 'not valid JSON';
    try {
      const parsed = JSON.parse(repairJsonString(raw));
      const result = schema.safeParse(parsed);
      if (!result.success) {
        issues = result.error.issues
          .map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`)
          .join('; ');
      }
    } catch {
      // keep the "not valid JSON" message
    }

    return [
      'The following JSON output does not match the required schema.',
      'Return ONLY corrected JSON matching the schema. No prose, no code fences.',
      '',
      'Schema:',
      JSON.stringify(jsonSchema),
      '',
      'Invalid output:',
      raw,
      '',
      'Validation issues:',
      issues,
    ].join('\n');
  }
}

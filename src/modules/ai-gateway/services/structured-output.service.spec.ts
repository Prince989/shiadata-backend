import { z } from 'zod';

import { StructuredOutputService } from './structured-output.service';

const Verdict = z.object({
  final_verdict: z.string(),
  score: z.number(),
});

describe('StructuredOutputService', () => {
  const service = new StructuredOutputService();

  it('parses valid JSON against the schema', () => {
    const outcome = service.parse(
      '{"final_verdict":"صحیح","score":1}',
      Verdict,
      'stop',
    );
    expect(outcome).toEqual({
      status: 'ok',
      repaired: false,
      data: { final_verdict: 'صحیح', score: 1 },
    });
  });

  it('treats max_tokens as truncation, not malformation', () => {
    const outcome = service.parse('{"final_verdict":"صح', Verdict, 'max_tokens');
    expect(outcome).toEqual({ status: 'truncated' });
  });

  it('repairs fenced JSON without an LLM round-trip', () => {
    const outcome = service.parse(
      '```json\n{"final_verdict":"موثق","score":2}\n```',
      Verdict,
      'stop',
    );
    expect(outcome.status).toBe('ok');
    if (outcome.status === 'ok') {
      expect(outcome.repaired).toBe(true);
      expect(outcome.data.final_verdict).toBe('موثق');
    }
  });

  it('signals needs_repair on schema violations instead of returning a partial object', () => {
    const outcome = service.parse(
      '{"final_verdict":"صحیح"}',
      Verdict,
      'stop',
    );
    expect(outcome.status).toBe('needs_repair');
    if (outcome.status === 'needs_repair') {
      expect(outcome.repairPrompt).toContain('Validation issues');
      expect(outcome.repairPrompt).not.toContain('original prompt');
    }
  });

  it('hashes the JSON schema so cache keys change when the Zod schema changes', () => {
    const a = service.toJsonSchema(Verdict, 'verdict-a');
    const b = service.toJsonSchema(
      z.object({ final_verdict: z.string(), score: z.number(), extra: z.string() }),
      'verdict-b',
    );
    expect(service.schemaHash(a)).not.toBe(service.schemaHash(b));
  });
});

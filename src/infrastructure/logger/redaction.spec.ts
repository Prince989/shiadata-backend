import { scrubSecrets } from './redaction';

describe('scrubSecrets', () => {
  it('redacts Google and OpenAI style keys in free-text log lines', () => {
    const google = 'AIza' + 'B'.repeat(35);
    const openai = 'sk-' + 'c'.repeat(20);
    const line = `provider error for ${google} and ${openai}`;
    const scrubbed = scrubSecrets(line);
    expect(scrubbed).not.toContain(google);
    expect(scrubbed).not.toContain(openai);
    expect(scrubbed).toContain('[REDACTED]');
  });

  it('leaves ordinary Arabic/Persian prose untouched', () => {
    const prose = 'امیرالمؤمنین علی بن ابی طالب';
    expect(scrubSecrets(prose)).toBe(prose);
  });
});

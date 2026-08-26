import { Injectable } from '@nestjs/common';

export type CrisisLevel = 'none' | 'low' | 'high' | 'imminent';

export interface LexiconHit {
  level: CrisisLevel;
  matched: string;
}

const IDIOMS =
  /مُردم از خنده|مردم از خنده|کشتی منو|کشتی‌ام از خنده|died laughing/i;

const IMMINENT = [
  /خودکشی/,
  /میخوام بمیرم/,
  /می\s*خواهم بمیرم/,
  /kill myself/i,
  /suicid/i,
  /أريد أن أموت/,
];

const HIGH = [/نمیخواهم زنده بمانم/, /want to die/i];

/**
 * Layer 0: deterministic, ~1ms, works when the LLM provider is down.
 * Persian idioms that look like death-talk must not fire.
 */
@Injectable()
export class CrisisLexiconService {
  scan(text: string): LexiconHit {
    const raw = text.trim();
    if (!raw) return { level: 'none', matched: '' };
    if (IDIOMS.test(raw)) return { level: 'none', matched: '' };
    for (const re of IMMINENT) {
      const m = re.exec(raw);
      if (m) return { level: 'imminent', matched: m[0] };
    }
    for (const re of HIGH) {
      const m = re.exec(raw);
      if (m) return { level: 'high', matched: m[0] };
    }
    return { level: 'none', matched: '' };
  }
}

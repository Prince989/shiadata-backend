import fc from 'fast-check';

import {
  contentHash,
  normalizeArabic,
  pairHash,
  unorderedPairHash,
} from './arabic-normalize';

describe('normalizeArabic', () => {
  it('folds a vocalized name onto its unvocalized form', () => {
    expect(normalizeArabic('مُحَمَّدُ بْنُ يَحْيَى')).toBe(
      normalizeArabic('محمد بن يحيى'),
    );
  });

  it('does not corrupt a medial alef', () => {
    // The Python port's predecessor bug (.replace("ا","أ")) would have
    // turned this into "أبرأهيم بن هأشم", matching no real document.
    const result = normalizeArabic('ابراهيم بن هاشم');
    expect(result).not.toContain('أ');
    expect(result).toBe('ابراهیم بن هاشم');
  });

  it('unifies yeh and kaf variants', () => {
    expect(normalizeArabic('علي')).toBe(normalizeArabic('علی'));
    expect(normalizeArabic('ك')).toBe(normalizeArabic('ک'));
  });

  it('is safe on empty and nullish input', () => {
    expect(normalizeArabic('')).toBe('');
    expect(normalizeArabic(null)).toBe('');
    expect(normalizeArabic(undefined)).toBe('');
  });

  it('is idempotent over arbitrary Arabic/Persian text', () => {
    const arabicChar = fc.constantFrom(
      ...'ابتثجحخدذرزسشصضطظعغفقكلمنهوىيءأإآؤئةًٌٍَُِّْـ '.split(''),
    );
    fc.assert(
      fc.property(
        fc.array(arabicChar, { maxLength: 30 }).map((cs) => cs.join('')),
        (s) => {
          const once = normalizeArabic(s);
          const twice = normalizeArabic(once);
          expect(twice).toBe(once);
        },
      ),
      { numRuns: 500 },
    );
  });
});

describe('contentHash', () => {
  it('is stable across diacritic and orthography variants', () => {
    expect(contentHash('مُحَمَّدُ بْنُ يَحْيَى')).toBe(
      contentHash('محمد بن يحيى'),
    );
  });

  it('differs for genuinely different text', () => {
    expect(contentHash('محمد بن یحیی')).not.toBe(contentHash('زراره بن اعین'));
  });
});

describe('pairHash', () => {
  it('is order-sensitive', () => {
    // Deliberately NOT symmetric: a conflict-resolution verdict's prose
    // refers to "حدیث اول"/"حدیث دوم" positionally, so swapping the two
    // inputs must produce a different cache key.
    const a = pairHash('حدیث اول', 'حدیث دوم');
    const b = pairHash('حدیث دوم', 'حدیث اول');
    expect(a).not.toBe(b);
  });

  it('is deterministic for the same order', () => {
    expect(pairHash('x', 'y')).toBe(pairHash('x', 'y'));
  });
});

describe('unorderedPairHash', () => {
  it('is order-INsensitive, unlike pairHash', () => {
    expect(unorderedPairHash('حدیث اول', 'حدیث دوم')).toBe(
      unorderedPairHash('حدیث دوم', 'حدیث اول'),
    );
  });
});

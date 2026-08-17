import { createHash } from 'node:crypto';

/**
 * Canonical Arabic/Persian normalization for cache keys and narrator/hadith
 * matching.
 *
 * This is a direct TypeScript port of AIEngine's core/text_normalize.py,
 * kept character-for-character equivalent on purpose: the two services
 * normalize different corpora (this one hashes user-submitted hadith text for
 * caching; Python's normalizes the rijal corpus for narrator lookup), but a
 * cache key and a lookup key for the *same underlying text* must collide, or
 * a hadith submitted to NestJS and later looked up via the Python engine
 * would silently miss.
 *
 * Never send normalized text to an LLM prompt in place of the original --
 * only use it for hashing and lookup.
 */

// Harakat, tanwin, shadda, dagger alef, and tatweel (kashida).
const TASHKEEL = /[ً-ٰٟۖ-ۭؐ-ؚـ]/g;

const ALEF_VARIANTS = /[أإآٱ]/g; // أ إ آ ٱ -> ا
const YEH_VARIANTS = /[يىئ]/g; // ي ى ئ -> ی
const KAF_VARIANTS = /[ك]/g; // ك -> ک
const TEH_MARBUTA = /[ة]/g; // ة -> ه
const WAW_HAMZA = /[ؤ]/g; // ؤ -> و
const BARE_HAMZA = /[ء]/g; // ء -> (removed)

const WHITESPACE = /\s+/g;

/**
 * Fold diacritics and letter-shape variants so semantically identical Arabic
 * text collides regardless of vocalization or Arabic/Persian orthography
 * (ي vs ی, ك vs ک, أ/إ/آ vs ا).
 *
 * Idempotent: normalizeArabic(normalizeArabic(x)) === normalizeArabic(x).
 */
export function normalizeArabic(input: string | null | undefined): string {
  if (!input) return '';

  return input
    .normalize('NFKC')
    .replace(TASHKEEL, '')
    .replace(ALEF_VARIANTS, 'ا') // -> ا
    .replace(YEH_VARIANTS, 'ی') // -> ی (Persian yeh)
    .replace(KAF_VARIANTS, 'ک') // -> ک (Persian keh)
    .replace(TEH_MARBUTA, 'ه') // -> ه
    .replace(WAW_HAMZA, 'و') // -> و
    .replace(BARE_HAMZA, '')
    .replace(WHITESPACE, ' ')
    .trim();
}

/** sha256 of the normalized text. Stable across diacritic/orthography variants. */
export function contentHash(raw: string): string {
  return createHash('sha256')
    .update(normalizeArabic(raw), 'utf8')
    .digest('hex');
}

/**
 * Order-SENSITIVE key for two-hadith operations (e.g. conflict resolution).
 *
 * Deliberately not symmetric: a conflict-resolution verdict's prose refers to
 * "حدیث اول" / "حدیث دوم" by position, so swapping two cached inputs would
 * serve a verdict whose reasoning names the wrong hadith. Only ever look up
 * with this hash, never with a sorted/symmetric variant.
 */
export function pairHash(hadith1: string, hadith2: string): string {
  return createHash('sha256')
    .update(`${contentHash(hadith1)}:${contentHash(hadith2)}`, 'utf8')
    .digest('hex');
}

/**
 * Order-INSENSITIVE key, for reporting/analytics only ("you already ran the
 * mirror of this") -- never for cache lookup or transparent substitution.
 */
export function unorderedPairHash(hadith1: string, hadith2: string): string {
  const [a, b] = [contentHash(hadith1), contentHash(hadith2)].sort();
  return createHash('sha256').update(`${a}:${b}`, 'utf8').digest('hex');
}

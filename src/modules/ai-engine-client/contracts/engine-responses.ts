import { z } from 'zod';

export const CollectionNameSchema = z.enum([
  'theology',
  'hadith',
  'rijal',
  'quran',
]);

export const RetrievedDocumentSchema = z.object({
  content: z.string(),
  metadata: z.record(z.string(), z.unknown()).default({}),
  distance: z.number().nullable().optional(),
  book_title: z.string().nullable().optional(),
  chapter: z.string().nullable().optional(),
  domain: z.string().nullable().optional(),
});

export const SearchResponseSchema = z.object({
  collection: z.string(),
  query: z.string(),
  total_found: z.number().int(),
  documents: z.array(RetrievedDocumentSchema),
});

export const CollectionInfoSchema = z.object({
  name: z.string(),
  count: z.number().int(),
  metadata_keys: z.array(z.string()).default([]),
});

export const ChatResponseSchema = z.object({
  answer: z.string(),
  sources: z.array(
    z.object({
      book: z.string(),
      chapter: z.string(),
      footnotes: z.string().nullable().optional(),
    }),
  ),
  language_detected: z.string().nullable().optional(),
});

export const NarratorSchema = z.object({
  name: z.string(),
  status: z.string(),
  scholars_opinion: z.string(),
  source: z.string(),
});

export const SanadValidationResponseSchema = z.object({
  overall_status: z.string(),
  narrators: z.array(NarratorSchema),
  detailed_analysis: z.string(),
});

export const SanadExtractionResponseSchema = z.object({
  narrators: z.array(z.string()),
  matn: z.string(),
  resolution_notes: z.string(),
});

export const IjtihadVerdictResponseSchema = z.object({
  narrators_status: z.array(
    z.object({
      name: z.string(),
      status: z.string(),
    }),
  ),
  sanad_status: z.string(),
  quran_alignment: z.string(),
  shawahid_status: z.string(),
  final_verdict: z.string(),
  detailed_reasoning: z.string(),
});

const HadithSingleAnalysisSchema = z.object({
  narrators: z.array(z.string()),
  matn: z.string(),
  sanad_status: z.string(),
});

export const ConflictResolutionResponseSchema = z.object({
  hadith_1_analysis: HadithSingleAnalysisSchema,
  hadith_2_analysis: HadithSingleAnalysisSchema,
  is_conflict_detected: z.boolean(),
  sanad_comparison: z.string(),
  quran_tarjih: z.string(),
  taqiyyah_analysis: z.string(),
  tarjih_rule_applied: z.string(),
  final_verdict: z.string(),
  detailed_reasoning: z.string(),
});

export const EngineHealthResponseSchema = z.object({
  status: z.string(),
  collections: z.record(z.string(), z.number()).default({}),
  rijal_index_size: z.number().int().nullable().optional(),
  degraded: z.record(z.string(), z.string()).default({}),
});

export type SearchResponse = z.infer<typeof SearchResponseSchema>;
export type CollectionInfo = z.infer<typeof CollectionInfoSchema>;
export type ChatResponse = z.infer<typeof ChatResponseSchema>;
export type SanadValidationResponse = z.infer<
  typeof SanadValidationResponseSchema
>;
export type SanadExtractionResponse = z.infer<
  typeof SanadExtractionResponseSchema
>;
export type IjtihadVerdictResponse = z.infer<
  typeof IjtihadVerdictResponseSchema
>;
export type ConflictResolutionResponse = z.infer<
  typeof ConflictResolutionResponseSchema
>;
export type EngineHealthResponse = z.infer<typeof EngineHealthResponseSchema>;

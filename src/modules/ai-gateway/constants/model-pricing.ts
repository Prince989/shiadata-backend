export interface ModelPricing {
  inputPerMTokUsd: number;
  outputPerMTokUsd: number;
}

/**
 * Data table, not code: a price change is a one-line edit here, not a
 * redeploy of pricing logic. Verify these against the providers' current
 * pricing pages before relying on them for a real budget -- they are the
 * mechanism's placeholder values, not a guarantee.
 */
export const MODEL_PRICING: Record<string, ModelPricing> = {
  'gemini-3.5-flash': { inputPerMTokUsd: 0.1, outputPerMTokUsd: 0.4 },
  'gpt-4o-mini': { inputPerMTokUsd: 0.15, outputPerMTokUsd: 0.6 },
  'gpt-5.6': { inputPerMTokUsd: 1.5, outputPerMTokUsd: 6.0 },
  'text-embedding-3-small': { inputPerMTokUsd: 0.02, outputPerMTokUsd: 0 },
};

/**
 * Priced pessimistically on purpose: an unrecognised model should never be
 * treated as free. Log a warning at the call site when this fallback is hit
 * so the table gets a real entry instead of silently under-billing forever.
 */
export const UNKNOWN_MODEL_PRICING: ModelPricing = {
  inputPerMTokUsd: 5.0,
  outputPerMTokUsd: 15.0,
};

export function getModelPricing(model: string): ModelPricing {
  return MODEL_PRICING[model] ?? UNKNOWN_MODEL_PRICING;
}

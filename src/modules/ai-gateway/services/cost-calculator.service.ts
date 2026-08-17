import { Injectable, Logger } from '@nestjs/common';

import { getModelPricing, MODEL_PRICING } from '../constants/model-pricing';

@Injectable()
export class CostCalculatorService {
  private readonly logger = new Logger(CostCalculatorService.name);
  private readonly warnedModels = new Set<string>();

  estimateCostUsd(
    inputTokens: number,
    outputTokens: number,
    model: string,
  ): number {
    if (!(model in MODEL_PRICING) && !this.warnedModels.has(model)) {
      this.warnedModels.add(model);
      this.logger.warn(
        `No pricing entry for model '${model}' -- using pessimistic fallback`,
      );
    }
    const pricing = getModelPricing(model);
    return (
      (inputTokens / 1_000_000) * pricing.inputPerMTokUsd +
      (outputTokens / 1_000_000) * pricing.outputPerMTokUsd
    );
  }
}

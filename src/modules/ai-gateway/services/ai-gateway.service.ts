import { createHash, randomUUID } from 'node:crypto';

import { Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { ZodType } from 'zod';

import type { LlmConfig, ProviderName } from '@config/index';
import { canonicalJson } from '@common/utils/canonical-json';
import { fullJitterBackoffMs, sleep } from '@common/utils/backoff';
import { getRequestId } from '@common/utils/request-context';
import { LLM_CACHE } from '../constants/ai-gateway.tokens';
import {
  LlmAllProvidersFailedError,
  LlmBadRequestError,
  LlmContentFilteredError,
  LlmDeadlineExceededError,
  LlmNoHealthyKeysError,
  LlmOutputTruncatedError,
  LlmSchemaViolationError,
} from '../errors/llm.errors';
import { ILlmCache } from '../interfaces/llm-cache.interface';
import { KeyFailureKind, LlmKey } from '../interfaces/key-pool.interface';
import {
  LlmProvider,
  ProviderRequest,
  ProviderResponse,
} from '../interfaces/llm-provider.interface';
import {
  LlmCallMeta,
  LlmRequestBase,
  LlmResult,
  StructuredLlmRequest,
} from '../interfaces/llm-request.interface';
import { CallLogService } from './call-log.service';
import { CostCalculatorService } from './cost-calculator.service';
import { GeminiProvider } from '../providers/gemini.provider';
import { KeyPoolService } from './key-pool.service';
import { LlmMetricsService } from './llm-metrics.service';
import { OpenAiProvider } from '../providers/openai.provider';
import { StructuredOutputService } from './structured-output.service';
import { TokenBudgetService } from './token-budget.service';

interface AttemptPlanEntry {
  provider: ProviderName;
  model: string;
  maxKeyTries: number;
}

interface RunResult {
  response: ProviderResponse;
  provider: ProviderName;
  key: LlmKey;
  model: string;
}

const MIN_REMAINING_MS_TO_ATTEMPT = 3000;
const MAX_REPAIR_ATTEMPTS_CAP = 2;

@Injectable()
export class AiGatewayService {
  private readonly config: LlmConfig;
  private readonly providers: Record<ProviderName, LlmProvider>;

  constructor(
    configService: ConfigService,
    private readonly keyPool: KeyPoolService,
    private readonly gemini: GeminiProvider,
    private readonly openai: OpenAiProvider,
    private readonly structuredOutput: StructuredOutputService,
    private readonly tokenBudget: TokenBudgetService,
    private readonly costCalculator: CostCalculatorService,
    private readonly metrics: LlmMetricsService,
    private readonly callLog: CallLogService,
    @Inject(LLM_CACHE) private readonly cache: ILlmCache,
  ) {
    this.config = configService.get<LlmConfig>('llm')!;
    this.providers = { gemini: this.gemini, openai: this.openai };
  }

  async complete(req: LlmRequestBase): Promise<LlmResult<string>> {
    const requestId = req.traceId ?? getRequestId() ?? randomUUID();
    const deadline = Date.now() + (req.deadlineMs ?? this.config.deadlineMs);
    const plan = this.buildAttemptPlan(req);
    if (plan.length === 0)
      throw new LlmNoHealthyKeysError('No configured providers with keys');

    this.tokenBudget.assertInputWithinLimit(
      `${req.system ?? ''}\n${req.prompt}`,
    );

    const maxOutputTokens = this.clampOutputTokens(req.maxOutputTokens);
    const estimatedInputTokens = this.tokenBudget.estimateInputTokens(
      req.prompt,
    );
    const reservedCostUsd = this.costCalculator.estimateCostUsd(
      estimatedInputTokens,
      maxOutputTokens,
      plan[0]!.model,
    );
    await this.tokenBudget.reserve(
      reservedCostUsd,
      req.budget.feature,
      req.budget.userId,
    );

    const attempts = { used: 0 };
    const startedAt = Date.now();

    try {
      const { response, provider, key, model } = await this.runWithRotation(
        plan,
        () => this.buildProviderRequest(req, maxOutputTokens),
        deadline,
        attempts,
        req.signal,
      );

      const costUsd = this.costCalculator.estimateCostUsd(
        response.usage.inputTokens,
        response.usage.outputTokens,
        model,
      );
      await this.tokenBudget.reconcile(
        costUsd - reservedCostUsd,
        req.budget.feature,
        req.budget.userId,
      );

      const meta: LlmCallMeta = {
        provider,
        model,
        keyId: key.id,
        attempts: attempts.used,
        cache: 'bypass',
        latencyMs: Date.now() - startedAt,
        finishReason: response.finishReason,
        repaired: false,
        usage: { ...response.usage, estimatedCostUsd: costUsd },
      };
      this.finishCall(
        req.budget.feature,
        req.budget.userId,
        requestId,
        meta,
        'success',
      );
      return { data: response.text, raw: response.text, meta };
    } catch (err) {
      await this.tokenBudget.reconcile(
        -reservedCostUsd,
        req.budget.feature,
        req.budget.userId,
      );
      this.metrics.recordCall(
        req.budget.feature,
        'error',
        Date.now() - startedAt,
      );
      throw err;
    }
  }

  async completeStructured<T>(
    req: StructuredLlmRequest<T>,
  ): Promise<LlmResult<T>> {
    const plan = this.buildAttemptPlan(req);
    if (plan.length === 0)
      throw new LlmNoHealthyKeysError('No configured providers with keys');

    this.tokenBudget.assertInputWithinLimit(
      `${req.system ?? ''}\n${req.prompt}`,
    );

    const jsonSchema = this.structuredOutput.toJsonSchema(
      req.schema,
      req.schemaName,
    );
    const schemaHash = this.structuredOutput.schemaHash(jsonSchema);
    const temperature = req.temperature ?? this.config.temperatureDefault;

    const cacheable =
      this.config.cacheEnabled &&
      this.config.cacheDriver !== 'none' &&
      req.cache?.enabled !== false &&
      temperature <= this.config.cacheMaxTemperature;
    const maxOutputTokensInitial = this.clampOutputTokens(req.maxOutputTokens);
    const cacheKey = cacheable
      ? this.buildCacheKey(req, schemaHash, temperature, maxOutputTokensInitial)
      : null;

    if (cacheKey) {
      const cached = await this.readCache<T>(cacheKey, req.schema);
      if (cached) {
        this.metrics.recordCache(req.budget.feature, true);
        return cached;
      }
      this.metrics.recordCache(req.budget.feature, false);
    }

    const lockAcquired = cacheKey
      ? await this.cache.tryLock(cacheKey, this.config.cacheLockTtlMs)
      : false;
    if (cacheKey && !lockAcquired) {
      const waited = await this.waitForCacheThenRead<T>(cacheKey, req.schema);
      if (waited) return waited;
      // Lock holder didn't finish in time -- proceed independently rather
      // than block forever on another replica.
    }

    try {
      const result = await this.executeStructured(
        req,
        plan,
        maxOutputTokensInitial,
      );
      if (cacheKey) {
        const {
          cache: _cache,
          latencyMs: _latencyMs,
          ...storableMeta
        } = result.meta;
        await this.cache.set(
          cacheKey,
          {
            raw: result.raw,
            data: result.data,
            meta: storableMeta,
            cachedAt: new Date().toISOString(),
          },
          req.cache?.ttlSeconds ?? this.config.cacheTtlSeconds,
        );
      }
      return result;
    } finally {
      if (cacheKey && lockAcquired) await this.cache.unlock(cacheKey);
    }
  }

  // ------------------------------------------------------------------

  private async executeStructured<T>(
    req: StructuredLlmRequest<T>,
    plan: AttemptPlanEntry[],
    maxOutputTokensInitial: number,
  ): Promise<LlmResult<T>> {
    const requestId = req.traceId ?? getRequestId() ?? randomUUID();
    const deadline = Date.now() + (req.deadlineMs ?? this.config.deadlineMs);

    const estimatedInputTokens = this.tokenBudget.estimateInputTokens(
      req.prompt,
    );
    const reservedCostUsd = this.costCalculator.estimateCostUsd(
      estimatedInputTokens,
      maxOutputTokensInitial,
      plan[0]!.model,
    );
    await this.tokenBudget.reserve(
      reservedCostUsd,
      req.budget.feature,
      req.budget.userId,
    );

    const attempts = { used: 0 };
    const startedAt = Date.now();
    let totalInputTokens = 0;
    let totalOutputTokens = 0;
    let maxOutputTokens = maxOutputTokensInitial;
    let repaired = false;

    try {
      let { response, provider, key, model } = await this.runWithRotation(
        plan,
        (m) =>
          this.buildProviderRequest(
            req,
            maxOutputTokens,
            m,
            req.schema,
            req.schemaName,
          ),
        deadline,
        attempts,
        req.signal,
      );
      totalInputTokens += response.usage.inputTokens;
      totalOutputTokens += response.usage.outputTokens;

      // Truncation: retry once at a higher ceiling, on the SAME key -- the
      // key is healthy, the output was just cut short. A repair prompt here
      // would be money spent re-deriving text we already know is incomplete.
      if (
        response.finishReason === 'max_tokens' &&
        maxOutputTokens < this.config.maxOutputTokensCeiling
      ) {
        maxOutputTokens = Math.min(
          Math.ceil(maxOutputTokens * 1.5),
          this.config.maxOutputTokensCeiling,
        );
        this.metrics.recordTruncation(req.budget.feature);
        const retryReq = this.buildProviderRequest(
          req,
          maxOutputTokens,
          model,
          req.schema,
          req.schemaName,
        );
        response = await this.providers[provider].generate(
          retryReq,
          key,
          this.attemptSignal(deadline, req.signal),
        );
        totalInputTokens += response.usage.inputTokens;
        totalOutputTokens += response.usage.outputTokens;
      }

      let outcome = this.structuredOutput.parse(
        response.text,
        req.schema,
        response.finishReason,
      );

      if (outcome.status === 'truncated') {
        this.metrics.recordTruncation(req.budget.feature);
        throw new LlmOutputTruncatedError(
          'AI response was truncated at the configured ceiling',
          {
            model,
          },
        );
      }

      let repairAttemptsLeft = Math.min(
        req.repairAttempts ?? 1,
        MAX_REPAIR_ATTEMPTS_CAP,
      );
      while (outcome.status === 'needs_repair' && repairAttemptsLeft > 0) {
        repairAttemptsLeft--;
        repaired = true;
        this.metrics.recordRepair(req.budget.feature);

        // Same key, temperature 0, schema/original prompt NOT resent -- only
        // the schema + bad output + validation issues, to avoid doubling the
        // input cost on the most expensive calls this system makes.
        const repairReq: ProviderRequest = {
          model,
          prompt: outcome.repairPrompt,
          temperature: 0,
          maxOutputTokens,
        };
        const repairResponse = await this.providers[provider].generate(
          repairReq,
          key,
          this.attemptSignal(deadline, req.signal),
        );
        totalInputTokens += repairResponse.usage.inputTokens;
        totalOutputTokens += repairResponse.usage.outputTokens;

        outcome = this.structuredOutput.parse(
          repairResponse.text,
          req.schema,
          repairResponse.finishReason,
        );
        response = repairResponse;
      }

      if (outcome.status !== 'ok') {
        throw new LlmSchemaViolationError(
          'AI response did not match the required schema',
          { model },
        );
      }

      const costUsd = this.costCalculator.estimateCostUsd(
        totalInputTokens,
        totalOutputTokens,
        model,
      );
      await this.tokenBudget.reconcile(
        costUsd - reservedCostUsd,
        req.budget.feature,
        req.budget.userId,
      );

      const meta: LlmCallMeta = {
        provider,
        model,
        keyId: key.id,
        attempts: attempts.used,
        cache: 'miss',
        latencyMs: Date.now() - startedAt,
        finishReason: response.finishReason,
        repaired,
        usage: {
          inputTokens: totalInputTokens,
          outputTokens: totalOutputTokens,
          estimatedCostUsd: costUsd,
        },
      };
      this.finishCall(
        req.budget.feature,
        req.budget.userId,
        requestId,
        meta,
        'success',
      );
      return { data: outcome.data, raw: response.text, meta };
    } catch (err) {
      // Simplification: on total failure we refund the full worst-case
      // reservation rather than tracking exactly how many input tokens a
      // failed attempt actually billed on the provider's side (many
      // failures -- 429, timeout -- bill nothing at all; a 500 after
      // accepting input is the rare case this slightly under-charges for).
      await this.tokenBudget.reconcile(
        -reservedCostUsd,
        req.budget.feature,
        req.budget.userId,
      );
      this.metrics.recordCall(
        req.budget.feature,
        'error',
        Date.now() - startedAt,
      );
      this.callLog.record({
        requestId,
        userId: req.budget.userId,
        feature: req.budget.feature,
        provider: plan[0]!.provider,
        model: plan[0]!.model,
        keyId: 'n/a',
        inputTokens: totalInputTokens,
        outputTokens: totalOutputTokens,
        costUsd: 0,
        latencyMs: Date.now() - startedAt,
        cacheHit: false,
        repaired,
        outcome: 'error',
        errorCode: err instanceof Error ? err.constructor.name : 'Unknown',
      });
      throw err;
    }
  }

  /**
   * The shared key-rotation/backoff loop. Tries each plan entry (primary
   * provider, then fallbacks) up to its own maxKeyTries, bounded overall by
   * LLM_MAX_ATTEMPTS and the wall-clock deadline -- whichever binds first.
   */
  private async runWithRotation(
    plan: AttemptPlanEntry[],
    buildRequest: (model: string) => ProviderRequest,
    deadline: number,
    attempts: { used: number },
    externalSignal?: AbortSignal,
  ): Promise<RunResult> {
    let gotAnyKey = false;

    for (const entry of plan) {
      for (let keyTry = 0; keyTry < entry.maxKeyTries; keyTry++) {
        if (attempts.used >= this.config.maxAttempts) {
          throw new LlmAllProvidersFailedError(
            'Exhausted max attempts across all providers',
          );
        }
        if (deadline - Date.now() < MIN_REMAINING_MS_TO_ATTEMPT) {
          throw new LlmDeadlineExceededError(
            'Not enough time remaining to start another attempt',
          );
        }

        const key = await this.keyPool.acquire(entry.provider);
        if (!key) break; // no healthy key for this provider right now -> try next plan entry

        gotAnyKey = true;
        attempts.used++;

        const provider = this.providers[entry.provider];
        const signal = this.attemptSignal(deadline, externalSignal);

        try {
          const response = await provider.generate(
            buildRequest(entry.model),
            key,
            signal,
          );
          await this.keyPool.reportSuccess(key.id);
          return {
            response,
            provider: entry.provider,
            key,
            model: entry.model,
          };
        } catch (err) {
          const kind = provider.classifyError(err);

          if (kind === KeyFailureKind.BadRequest) {
            throw new LlmBadRequestError(
              'The AI provider rejected the request',
              {
                provider: entry.provider,
              },
            );
          }
          if (kind === KeyFailureKind.ContentFiltered) {
            throw new LlmContentFilteredError(
              'Content blocked by provider safety filters',
              {
                provider: entry.provider,
              },
            );
          }

          const retryAfterMs = provider.extractRetryAfterMs(err);
          await this.keyPool.reportFailure(key.id, kind, retryAfterMs);
          this.metrics.recordCooldown('gateway');

          const stillTime = deadline - Date.now() > MIN_REMAINING_MS_TO_ATTEMPT;
          const moreTries =
            keyTry < entry.maxKeyTries - 1 &&
            attempts.used < this.config.maxAttempts;
          if (stillTime && moreTries) {
            const backoff =
              retryAfterMs ??
              fullJitterBackoffMs(
                attempts.used,
                this.config.retryBaseMs,
                this.config.retryMaxMs,
              );
            const cappedBackoff = Math.min(
              backoff,
              Math.max(0, deadline - Date.now() - MIN_REMAINING_MS_TO_ATTEMPT),
            );
            await sleep(cappedBackoff);
          }
        }
      }
    }

    if (!gotAnyKey)
      throw new LlmNoHealthyKeysError(
        'Every configured key is currently cooling down',
      );
    throw new LlmAllProvidersFailedError(
      'All providers failed for this request',
    );
  }

  private buildAttemptPlan(req: LlmRequestBase): AttemptPlanEntry[] {
    const plan: AttemptPlanEntry[] = [];
    const primarySize = this.keyPool.poolSize(this.config.primaryProvider);
    if (primarySize > 0) {
      plan.push({
        provider: this.config.primaryProvider,
        model: req.model ?? this.config.defaultModel,
        maxKeyTries: Math.min(3, primarySize),
      });
    }

    if (req.allowProviderFallback !== false) {
      for (const fb of this.config.fallbackProviders) {
        if (fb === this.config.primaryProvider) continue;
        const size = this.keyPool.poolSize(fb);
        if (size > 0) {
          plan.push({
            provider: fb,
            model: this.config.fallbackModel,
            maxKeyTries: Math.min(2, size),
          });
        }
      }
    }

    return plan;
  }

  private buildProviderRequest<T>(
    req: LlmRequestBase,
    maxOutputTokens: number,
    model?: string,
    schema?: ZodType<T>,
    schemaName?: string,
  ): ProviderRequest {
    return {
      model: model ?? req.model ?? this.config.defaultModel,
      system: req.system,
      prompt: req.prompt,
      temperature: req.temperature ?? this.config.temperatureDefault,
      maxOutputTokens,
      thinkingBudget: req.thinkingBudget ?? this.config.thinkingBudget,
      ...(schema && schemaName
        ? {
            jsonSchema: this.providers[
              this.config.primaryProvider
            ].normalizeSchema(
              this.structuredOutput.toJsonSchema(schema, schemaName),
            ),
            schemaName,
          }
        : {}),
    };
  }

  private clampOutputTokens(requested?: number): number {
    return Math.min(
      requested ?? this.config.maxOutputTokensDefault,
      this.config.maxOutputTokensCeiling,
    );
  }

  private attemptSignal(
    deadline: number,
    externalSignal?: AbortSignal,
  ): AbortSignal {
    const controller = new AbortController();
    const timeoutMs = Math.max(
      0,
      Math.min(this.config.requestTimeoutMs, deadline - Date.now()),
    );
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    controller.signal.addEventListener('abort', () => clearTimeout(timer));
    externalSignal?.addEventListener('abort', () => controller.abort());
    return controller.signal;
  }

  private buildCacheKey<T>(
    req: StructuredLlmRequest<T>,
    schemaHash: string,
    temperature: number,
    maxOutputTokens: number,
  ): string {
    const namespace = req.cache?.namespace ?? 'global';
    const payload = canonicalJson({
      model: req.model ?? this.config.defaultModel,
      system: req.system ?? null,
      prompt: req.prompt,
      schemaName: req.schemaName,
      schemaHash,
      temperature,
      maxOutputTokens,
    });
    const hash = createHash('sha256').update(payload).digest('hex');
    return `aigw:${this.config.cacheVersion}:${namespace}:${hash}`;
  }

  private async readCache<T>(
    cacheKey: string,
    schema: ZodType<T>,
  ): Promise<LlmResult<T> | null> {
    const cached = await this.cache.get(cacheKey);
    if (!cached) return null;

    const result = schema.safeParse(cached.data);
    if (!result.success) {
      // Stale shape (schema changed since this was cached) -- clean miss.
      await this.cache.del(cacheKey);
      return null;
    }

    return {
      data: result.data,
      raw: cached.raw,
      meta: {
        ...cached.meta,
        cache: 'hit',
        latencyMs: 0,
        usage: { ...cached.meta.usage, estimatedCostUsd: 0 },
      },
    };
  }

  private async waitForCacheThenRead<T>(
    cacheKey: string,
    schema: ZodType<T>,
    maxWaitMs = 5000,
  ): Promise<LlmResult<T> | null> {
    const deadline = Date.now() + maxWaitMs;
    while (Date.now() < deadline) {
      await sleep(250);
      const result = await this.readCache(cacheKey, schema);
      if (result) return result;
    }
    return null;
  }

  private finishCall(
    feature: string,
    userId: string | undefined,
    requestId: string,
    meta: LlmCallMeta,
    outcome: 'success' | 'error',
  ): void {
    this.metrics.recordCall(feature, outcome, meta.latencyMs);
    this.callLog.record({
      requestId,
      userId,
      feature,
      provider: meta.provider,
      model: meta.model,
      keyId: meta.keyId,
      inputTokens: meta.usage.inputTokens,
      outputTokens: meta.usage.outputTokens,
      costUsd: meta.usage.estimatedCostUsd,
      latencyMs: meta.latencyMs,
      cacheHit: meta.cache === 'hit',
      repaired: meta.repaired,
      outcome,
    });
  }
}

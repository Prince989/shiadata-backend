import { registerAs } from '@nestjs/config';

export type ProviderName = 'gemini' | 'openai';

export interface LlmConfig {
  primaryProvider: ProviderName;
  fallbackProviders: ProviderName[];
  defaultModel: string;
  fastModel: string;
  fallbackModel: string;
  temperatureDefault: number;
  maxOutputTokensDefault: number;
  maxOutputTokensCeiling: number;
  maxInputTokens: number;
  inputCharsPerToken: number;
  thinkingBudget: number;
  requestTimeoutMs: number;
  deadlineMs: number;
  maxAttempts: number;
  retryBaseMs: number;
  retryMaxMs: number;

  keyCooldownBaseMs: number;
  keyCooldownMaxMs: number;
  keyQuotaCooldownMs: number;
  keyFailureThreshold: number;
  keySuccessResetCount: number;

  cacheDriver: 'redis' | 'memory' | 'none';
  cacheEnabled: boolean;
  cacheTtlSeconds: number;
  cacheMaxTemperature: number;
  cacheVersion: string;
  cacheLockTtlMs: number;

  budgetEnforce: boolean;
  dailyBudgetUsd: number;
  userDailyBudgetUsd: number;
  userDailyCallLimit: number;
  callLogEnabled: boolean;
  callLogTtlDays: number;
}

function parseProviderList(raw: string | undefined): ProviderName[] {
  return (raw ?? '')
    .split(',')
    .map((p) => p.trim())
    .filter((p): p is ProviderName => p === 'gemini' || p === 'openai');
}

export default registerAs('llm', (): LlmConfig => ({
  primaryProvider:
    (process.env.LLM_PRIMARY_PROVIDER as ProviderName) ?? 'gemini',
  fallbackProviders: parseProviderList(process.env.LLM_FALLBACK_PROVIDERS),
  defaultModel: process.env.LLM_DEFAULT_MODEL ?? 'gemini-3.5-flash',
  fastModel: process.env.LLM_FAST_MODEL ?? 'gemini-3.5-flash',
  fallbackModel: process.env.LLM_FALLBACK_MODEL ?? 'gpt-4o-mini',
  temperatureDefault: Number(process.env.LLM_TEMPERATURE_DEFAULT ?? 0),
  maxOutputTokensDefault: Number(
    process.env.LLM_MAX_OUTPUT_TOKENS_DEFAULT ?? 2048,
  ),
  maxOutputTokensCeiling: Number(
    process.env.LLM_MAX_OUTPUT_TOKENS_CEILING ?? 8192,
  ),
  maxInputTokens: Number(process.env.LLM_MAX_INPUT_TOKENS ?? 100_000),
  inputCharsPerToken: Number(process.env.LLM_INPUT_CHARS_PER_TOKEN ?? 2.5),
  thinkingBudget: Number(process.env.LLM_THINKING_BUDGET ?? 0),
  requestTimeoutMs: Number(process.env.LLM_REQUEST_TIMEOUT_MS ?? 60_000),
  deadlineMs: Number(process.env.LLM_DEADLINE_MS ?? 90_000),
  maxAttempts: Number(process.env.LLM_MAX_ATTEMPTS ?? 4),
  retryBaseMs: Number(process.env.LLM_RETRY_BASE_MS ?? 500),
  retryMaxMs: Number(process.env.LLM_RETRY_MAX_MS ?? 8000),

  keyCooldownBaseMs: Number(process.env.LLM_KEY_COOLDOWN_BASE_MS ?? 30_000),
  keyCooldownMaxMs: Number(process.env.LLM_KEY_COOLDOWN_MAX_MS ?? 1_800_000),
  keyQuotaCooldownMs: Number(
    process.env.LLM_KEY_QUOTA_COOLDOWN_MS ?? 21_600_000,
  ),
  keyFailureThreshold: Number(process.env.LLM_KEY_FAILURE_THRESHOLD ?? 3),
  keySuccessResetCount: Number(process.env.LLM_KEY_SUCCESS_RESET_COUNT ?? 3),

  cacheDriver:
    (process.env.LLM_CACHE_DRIVER as LlmConfig['cacheDriver']) ?? 'redis',
  cacheEnabled: process.env.LLM_CACHE_ENABLED !== 'false',
  cacheTtlSeconds: Number(process.env.LLM_CACHE_TTL_SECONDS ?? 86_400),
  cacheMaxTemperature: Number(process.env.LLM_CACHE_MAX_TEMPERATURE ?? 0.2),
  cacheVersion: process.env.LLM_CACHE_VERSION ?? 'v1',
  cacheLockTtlMs: Number(process.env.LLM_CACHE_LOCK_TTL_MS ?? 15_000),

  budgetEnforce: process.env.LLM_BUDGET_ENFORCE !== 'false',
  dailyBudgetUsd: Number(process.env.LLM_DAILY_BUDGET_USD ?? 25),
  userDailyBudgetUsd: Number(process.env.LLM_USER_DAILY_BUDGET_USD ?? 1),
  userDailyCallLimit: Number(process.env.LLM_USER_DAILY_CALL_LIMIT ?? 100),
  callLogEnabled: process.env.LLM_CALL_LOG_ENABLED !== 'false',
  callLogTtlDays: Number(process.env.LLM_CALL_LOG_TTL_DAYS ?? 90),
}));

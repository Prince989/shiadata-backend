import * as Joi from 'joi';

/**
 * Fail-fast environment validation.
 *
 * `abortEarly: false` (set where this schema is registered) means a fresh
 * clone that's missing five env vars sees all five at once on the first
 * boot attempt, not one per restart-edit-restart cycle.
 */
export const envValidationSchema = Joi.object({
  NODE_ENV: Joi.string()
    .valid('development', 'test', 'production')
    .default('development'),
  PORT: Joi.number().port().default(3000),
  APP_NAME: Joi.string().default('shiadata-backend'),
  API_PREFIX: Joi.string().default('api'),
  CORS_ORIGINS: Joi.string().allow('').default(''),
  CORS_CREDENTIALS: Joi.boolean().default(true),
  TRUST_PROXY: Joi.boolean().default(false),
  SWAGGER_ENABLED: Joi.boolean().default(true),
  SWAGGER_PATH: Joi.string().default('docs'),
  LOG_LEVEL: Joi.string()
    .valid('trace', 'debug', 'info', 'warn', 'error', 'fatal')
    .default('debug'),
  LOG_PRETTY: Joi.boolean().default(true),
  REQUEST_TIMEOUT_MS: Joi.number().integer().min(1000).default(120_000),
  EXPOSE_ERROR_DETAILS: Joi.boolean().default(false),
  OPS_TOKEN: Joi.string().allow('').default(''),

  MONGO_URI: Joi.string().uri().required(),
  MONGO_DB_NAME: Joi.string().default('shiadata'),
  MONGO_MAX_POOL_SIZE: Joi.number().integer().min(1).default(20),
  MONGO_SERVER_SELECTION_TIMEOUT_MS: Joi.number()
    .integer()
    .min(100)
    .default(5000),
  MONGO_AUTO_INDEX: Joi.boolean().default(true),

  REDIS_HOST: Joi.string().required(),
  REDIS_PORT: Joi.number().port().required(),
  REDIS_PASSWORD: Joi.string().allow('').default(''),
  REDIS_DB: Joi.number().integer().min(0).default(0),
  REDIS_TLS: Joi.boolean().default(false),
  REDIS_KEY_PREFIX: Joi.string().default('shiadata:'),

  JWT_ACCESS_SECRET: Joi.string().allow('').default(''),
  JWT_ACCESS_TTL: Joi.string().default('15m'),
  JWT_REFRESH_SECRET: Joi.string().allow('').default(''),
  JWT_REFRESH_TTL: Joi.string().default('7d'),
  JWT_ISSUER: Joi.string().default('shiadata'),
  JWT_AUDIENCE: Joi.string().default('shiadata-api'),

  PYTHON_ENGINE_BASE_URL: Joi.string().uri().default('http://127.0.0.1:8000'),
  PYTHON_ENGINE_INTERNAL_API_KEY: Joi.string().allow('').default(''),
  PYTHON_ENGINE_HOST: Joi.string().default('127.0.0.1'),
  PYTHON_ENGINE_PORT: Joi.number().port().default(8000),

  THROTTLE_STORAGE: Joi.string().valid('redis', 'memory').default('redis'),

  LLM_PRIMARY_PROVIDER: Joi.string()
    .valid('gemini', 'openai')
    .default('gemini'),
  LLM_FALLBACK_PROVIDERS: Joi.string().allow('').default(''),
  LLM_DEFAULT_MODEL: Joi.string().default('gemini-3.5-flash'),
  LLM_MAX_OUTPUT_TOKENS_CEILING: Joi.number().integer().min(1).default(8192),
  LLM_MAX_INPUT_TOKENS: Joi.number().integer().min(1).default(100_000),
  LLM_CACHE_DRIVER: Joi.string()
    .valid('redis', 'memory', 'none')
    .default('redis'),
})
  .unknown(true)
  .custom((value: Record<string, unknown>, helpers) => {
    // In production, refusing to boot with EXPOSE_ERROR_DETAILS=true is the
    // point: that flag puts stack traces and upstream error bodies into
    // client-facing 5xx responses.
    if (
      value.NODE_ENV === 'production' &&
      value.EXPOSE_ERROR_DETAILS === true
    ) {
      return helpers.error('any.custom', {
        message:
          'EXPOSE_ERROR_DETAILS must not be true when NODE_ENV=production',
      });
    }

    // At least one distinct Gemini key is required for the LLM-backed
    // routes; the gateway degrades gracefully at the service level (see
    // KeyPoolService), but a totally empty pool for the primary provider
    // means every structured-output call fails, so surface that at boot.
    const googleKeys = Object.keys(value).filter(
      (k) => /^GOOGLE_API_KEY\d*$/.test(k) && value[k],
    );
    if (value.LLM_PRIMARY_PROVIDER === 'gemini' && googleKeys.length === 0) {
      return helpers.error('any.custom', {
        message: 'LLM_PRIMARY_PROVIDER=gemini but no GOOGLE_API_KEY* is set',
      });
    }

    const fallbackProvidersRaw =
      typeof value.LLM_FALLBACK_PROVIDERS === 'string' ? value.LLM_FALLBACK_PROVIDERS : '';
    const fallbacks = fallbackProvidersRaw
      .split(',')
      .map((p) => p.trim())
      .filter(Boolean);
    if (fallbacks.includes('openai')) {
      const openaiKeys = Object.keys(value).filter(
        (k) => /^OPENAI_API_KEY\d*$/.test(k) && value[k],
      );
      if (openaiKeys.length === 0) {
        return helpers.error('any.custom', {
          message:
            'LLM_FALLBACK_PROVIDERS includes "openai" but no OPENAI_API_KEY* is set',
        });
      }
    }

    return value;
  });

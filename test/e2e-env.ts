/**
 * Process env for HTTP e2e. Must load before AppModule / Joi validation.
 * Points at the compose Mongo (27018) and Redis (6380) from docker-compose.yml.
 */
process.env.NODE_ENV ??= 'test';
process.env.PORT ??= '3000';
process.env.MONGO_URI ??=
  'mongodb://127.0.0.1:27018/shiadata_e2e?directConnection=true';
process.env.MONGO_DB_NAME ??= 'shiadata_e2e';
process.env.REDIS_HOST ??= '127.0.0.1';
process.env.REDIS_PORT ??= '6380';
process.env.THROTTLE_STORAGE ??= 'memory';
process.env.LLM_CACHE_DRIVER ??= 'memory';
process.env.LLM_PRIMARY_PROVIDER ??= 'gemini';
process.env.GOOGLE_API_KEY ??= 'e2e-dummy-google-key';
process.env.LOG_LEVEL ??= 'error';
process.env.LOG_PRETTY ??= 'false';
process.env.SWAGGER_ENABLED ??= 'false';
process.env.EXPOSE_ERROR_DETAILS ??= 'true';
process.env.JWT_ACCESS_SECRET ??= 'e2e-access-secret';
process.env.JWT_REFRESH_SECRET ??= 'e2e-refresh-secret';
process.env.PYTHON_ENGINE_BASE_URL ??= 'http://127.0.0.1:8000';
process.env.REQUEST_TIMEOUT_MS ??= '120000';

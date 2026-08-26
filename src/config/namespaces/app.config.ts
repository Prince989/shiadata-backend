import { registerAs } from '@nestjs/config';

export interface AppConfig {
  nodeEnv: 'development' | 'test' | 'production';
  port: number;
  name: string;
  apiPrefix: string;
  corsOrigins: string[];
  corsCredentials: boolean;
  trustProxy: boolean;
  swaggerEnabled: boolean;
  swaggerPath: string;
  logLevel: string;
  logPretty: boolean;
  requestTimeoutMs: number;
  exposeErrorDetails: boolean;
  opsToken: string;
}

export default registerAs('app', (): AppConfig => ({
  nodeEnv: (process.env.NODE_ENV as AppConfig['nodeEnv']) ?? 'development',
  port: Number(process.env.PORT ?? 3000),
  name: process.env.APP_NAME ?? 'shiadata-backend',
  apiPrefix: process.env.API_PREFIX ?? 'api',
  corsOrigins: (process.env.CORS_ORIGINS ?? '')
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean),
  corsCredentials: process.env.CORS_CREDENTIALS !== 'false',
  trustProxy: process.env.TRUST_PROXY === 'true',
  swaggerEnabled: process.env.SWAGGER_ENABLED !== 'false',
  swaggerPath: process.env.SWAGGER_PATH ?? 'docs',
  logLevel: process.env.LOG_LEVEL ?? 'debug',
  logPretty: process.env.LOG_PRETTY !== 'false',
  requestTimeoutMs: Number(process.env.REQUEST_TIMEOUT_MS ?? 120_000),
  exposeErrorDetails: process.env.EXPOSE_ERROR_DETAILS === 'true',
  opsToken: process.env.OPS_TOKEN ?? '',
}));

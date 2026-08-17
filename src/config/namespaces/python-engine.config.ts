import { registerAs } from '@nestjs/config';

export interface PythonEngineConfig {
  baseUrl: string;
  internalApiKey: string;
  host: string;
  port: number;
}

export default registerAs('pythonEngine', (): PythonEngineConfig => ({
  baseUrl: process.env.PYTHON_ENGINE_BASE_URL ?? 'http://127.0.0.1:8000',
  internalApiKey: process.env.PYTHON_ENGINE_INTERNAL_API_KEY ?? '',
  host: process.env.PYTHON_ENGINE_HOST ?? '127.0.0.1',
  port: Number(process.env.PYTHON_ENGINE_PORT ?? 8000),
}));

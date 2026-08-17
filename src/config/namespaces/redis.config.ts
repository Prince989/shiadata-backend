import { registerAs } from '@nestjs/config';

export interface RedisConfig {
  host: string;
  port: number;
  password: string;
  db: number;
  tls: boolean;
  keyPrefix: string;
}

export default registerAs('redis', (): RedisConfig => ({
  host: process.env.REDIS_HOST ?? 'localhost',
  port: Number(process.env.REDIS_PORT ?? 6379),
  password: process.env.REDIS_PASSWORD ?? '',
  db: Number(process.env.REDIS_DB ?? 0),
  tls: process.env.REDIS_TLS === 'true',
  keyPrefix: process.env.REDIS_KEY_PREFIX ?? 'shiadata:',
}));

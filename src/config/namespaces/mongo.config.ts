import { registerAs } from '@nestjs/config';

export interface MongoConfig {
  uri: string;
  dbName: string;
  maxPoolSize: number;
  serverSelectionTimeoutMs: number;
  autoIndex: boolean;
}

export default registerAs('mongo', (): MongoConfig => ({
  uri: process.env.MONGO_URI ?? '',
  dbName: process.env.MONGO_DB_NAME ?? 'shiadata',
  maxPoolSize: Number(process.env.MONGO_MAX_POOL_SIZE ?? 20),
  serverSelectionTimeoutMs: Number(
    process.env.MONGO_SERVER_SELECTION_TIMEOUT_MS ?? 5000,
  ),
  autoIndex: process.env.MONGO_AUTO_INDEX !== 'false',
}));

import { registerAs } from '@nestjs/config';

export interface ThrottlerConfig {
  storage: 'redis' | 'memory';
}

export default registerAs('throttler', (): ThrottlerConfig => ({
  storage: (process.env.THROTTLE_STORAGE as 'redis' | 'memory') ?? 'redis',
}));

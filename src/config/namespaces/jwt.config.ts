import { registerAs } from '@nestjs/config';

export interface JwtConfig {
  accessSecret: string;
  accessTtl: string;
  refreshSecret: string;
  refreshTtl: string;
  issuer: string;
  audience: string;
}

export default registerAs('jwt', (): JwtConfig => ({
  accessSecret: process.env.JWT_ACCESS_SECRET ?? '',
  accessTtl: process.env.JWT_ACCESS_TTL ?? '15m',
  refreshSecret: process.env.JWT_REFRESH_SECRET ?? '',
  refreshTtl: process.env.JWT_REFRESH_TTL ?? '7d',
  issuer: process.env.JWT_ISSUER ?? 'shiadata',
  audience: process.env.JWT_AUDIENCE ?? 'shiadata-api',
}));

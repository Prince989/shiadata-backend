import { timingSafeEqual } from 'node:crypto';

import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Request } from 'express';

import type { AppConfig } from '@config/index';
import { UnauthorizedAppError } from '@common/errors/app.error';

/**
 * Guards internal/admin endpoints (LLM key-pool inspection, spend, cache
 * stats) before real RBAC exists (milestone 6). Constant-time comparison,
 * same reasoning as the Python engine's X-Internal-API-Key check: a plain
 * `!==` leaks the token one differing byte at a time via response timing.
 */
@Injectable()
export class OpsTokenGuard implements CanActivate {
  constructor(private readonly config: ConfigService) {}

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<Request>();
    const expected = this.config.get<AppConfig>('app')!.opsToken;
    const provided = request.headers['x-ops-token'];

    if (!expected || typeof provided !== 'string') {
      throw new UnauthorizedAppError('Missing or unconfigured ops token');
    }

    const expectedBuf = Buffer.from(expected);
    const providedBuf = Buffer.from(provided);
    if (
      expectedBuf.length !== providedBuf.length ||
      !timingSafeEqual(expectedBuf, providedBuf)
    ) {
      throw new UnauthorizedAppError('Invalid ops token');
    }

    return true;
  }
}

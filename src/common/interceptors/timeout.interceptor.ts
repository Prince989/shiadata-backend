import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Observable, TimeoutError } from 'rxjs';
import { catchError, timeout } from 'rxjs/operators';

import { AppConfig } from '@config/index';
import { RequestTimeoutAppError } from '@common/errors/app.error';

/**
 * Global request deadline. Deliberately generous (default 30s) and meant as
 * a backstop for routes that forget their own timeout, not as the primary
 * control for slow upstreams -- the Python engine client sets its own
 * per-endpoint timeouts (up to 180s for the heavy routes), which this global
 * value must never race against once that client exists.
 */
@Injectable()
export class TimeoutInterceptor implements NestInterceptor {
  constructor(private readonly config: ConfigService) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const ms = this.config.get<AppConfig>('app')!.requestTimeoutMs;
    return next.handle().pipe(
      timeout(ms),
      catchError((err) => {
        if (err instanceof TimeoutError) {
          throw new RequestTimeoutAppError(
            'Request exceeded the global timeout',
            { ms },
          );
        }
        throw err;
      }),
    );
  }
}

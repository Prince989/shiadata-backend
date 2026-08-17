import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import type { Request } from 'express';
import { Observable } from 'rxjs';

import { runWithRequestContext } from '@common/utils/request-context';

/**
 * Mirrors the request id pino-http already generated (see
 * LoggerModule's genReqId, which also sets the X-Request-Id response header)
 * into AsyncLocalStorage, so services that don't have access to the request
 * object can still tag their own logs and outbound calls with it.
 */
@Injectable()
export class RequestIdInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const request = context
      .switchToHttp()
      .getRequest<Request & { id?: string }>();
    const requestId = request.id ?? 'unknown';

    let result$!: Observable<unknown>;
    runWithRequestContext({ requestId }, () => {
      result$ = next.handle();
    });
    return result$;
  }
}

import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Request, Response } from 'express';
import { PinoLogger } from 'nestjs-pino';
import { Error as MongooseError } from 'mongoose';

import { AppConfig } from '@config/index';
import { AppError } from '@common/errors/app.error';
import { ErrorCode } from '@common/errors/error-codes.enum';

interface ErrorEnvelope {
  statusCode: number;
  error: string;
  code: string;
  message: string;
  requestId: string;
  timestamp: string;
  path: string;
  details?: unknown;
  stack?: string;
  cause?: unknown;
}

/**
 * Single point of translation from "whatever was thrown" to the HTTP
 * response. The rule that matters most: for any 5xx, `message` is always a
 * fixed generic string, never `err.message`. The real cause is logged
 * server-side under the same requestId.
 *
 * This is also the backstop against a specific known leak: every AIEngine
 * route currently does `HTTPException(500, detail=str(e))`, and that body
 * can carry prompt fragments, absolute file paths, or Chroma internals. When
 * that response reaches here (via the Python engine client, once it exists),
 * it must never be forwarded verbatim to our own clients.
 */
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  constructor(
    private readonly config: ConfigService,
    private readonly logger: PinoLogger,
  ) {
    this.logger.setContext(AllExceptionsFilter.name);
  }

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const request = ctx.getRequest<Request & { id?: string }>();
    const response = ctx.getResponse<Response>();

    const requestId = request.id ?? 'unknown';
    const path = request.url;
    const exposeDetails = this.config.get<AppConfig>('app')!.exposeErrorDetails;

    const resolved = this.resolve(exception);

    const envelope: ErrorEnvelope = {
      statusCode: resolved.status,
      error: HttpStatus[resolved.status] ?? 'Error',
      code: resolved.code,
      message:
        resolved.status >= 500
          ? 'An unexpected error occurred'
          : resolved.message,
      requestId,
      timestamp: new Date().toISOString(),
      path,
      ...(resolved.details !== undefined ? { details: resolved.details } : {}),
    };

    if (exposeDetails) {
      envelope.stack = exception instanceof Error ? exception.stack : undefined;
      envelope.cause = resolved.internalMessage;
    }

    if (resolved.retryAfterSeconds !== undefined) {
      response.setHeader('Retry-After', String(resolved.retryAfterSeconds));
    }

    this.log(resolved.status, requestId, path, resolved, exception);

    response.status(resolved.status).json(envelope);
  }

  private resolve(exception: unknown): {
    status: number;
    code: string;
    message: string;
    internalMessage: string;
    details?: unknown;
    retryAfterSeconds?: number;
    logContext?: Record<string, unknown>;
  } {
    if (exception instanceof AppError) {
      return {
        status: exception.httpStatus,
        code: exception.code,
        message: exception.safeMessage,
        internalMessage: exception.message,
        retryAfterSeconds: exception.retryAfterSeconds,
        logContext: exception.logContext,
      };
    }

    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const body = exception.getResponse();
      const message =
        typeof body === 'string'
          ? body
          : Array.isArray((body as { message?: unknown }).message)
            ? 'Validation failed'
            : ((body as { message?: string }).message ?? exception.message);
      const details =
        typeof body === 'object' &&
        Array.isArray((body as { message?: unknown }).message)
          ? (body as { message: unknown }).message
          : undefined;

      return {
        status,
        code:
          status === 400
            ? ErrorCode.VALIDATION_FAILED
            : ErrorCode.INTERNAL_ERROR,
        message,
        internalMessage: exception.message,
        details,
      };
    }

    if (exception instanceof MongooseError.ValidationError) {
      return {
        status: 422,
        code: ErrorCode.VALIDATION_FAILED,
        message: 'Validation failed',
        internalMessage: exception.message,
        details: Object.keys(exception.errors),
      };
    }

    if (exception instanceof MongooseError.CastError) {
      return {
        status: 400,
        code: ErrorCode.VALIDATION_FAILED,
        message: `Invalid value for field '${exception.path}'`,
        internalMessage: exception.message,
      };
    }

    // Mongo duplicate-key error. Field name only -- never the conflicting
    // value, which would leak e.g. another user's email.
    if (this.isDuplicateKeyError(exception)) {
      const field = Object.keys(exception.keyPattern ?? {})[0] ?? 'field';
      return {
        status: 409,
        code: ErrorCode.DUPLICATE_KEY,
        message: `A record with this ${field} already exists`,
        internalMessage: exception.message,
      };
    }

    const internalMessage =
      exception instanceof Error ? exception.message : String(exception);
    return {
      status: 500,
      code: ErrorCode.INTERNAL_ERROR,
      message: 'An unexpected error occurred',
      internalMessage,
    };
  }

  private isDuplicateKeyError(exception: unknown): exception is Error & {
    code: number;
    keyPattern?: Record<string, unknown>;
  } {
    return (
      typeof exception === 'object' &&
      exception !== null &&
      'code' in exception &&
      (exception as { code?: unknown }).code === 11000
    );
  }

  private log(
    status: number,
    requestId: string,
    path: string,
    resolved: {
      code: string;
      internalMessage: string;
      logContext?: Record<string, unknown>;
    },
    exception: unknown,
  ): void {
    const meta = {
      requestId,
      path,
      code: resolved.code,
      ...resolved.logContext,
    };

    // 5xx -> error (paging-worthy), 429 -> warn, everything else -> info (a
    // 400 flood is a client bug, not an incident).
    if (status >= 500) {
      this.logger.error({ ...meta, err: exception }, resolved.internalMessage);
    } else if (status === 429) {
      this.logger.warn(meta, resolved.internalMessage);
    } else {
      this.logger.info(meta, resolved.internalMessage);
    }
  }
}

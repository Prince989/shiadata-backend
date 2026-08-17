import { ErrorCode } from './error-codes.enum';

/**
 * Base class for every domain error in the app.
 *
 * `safeMessage` is what a client ever sees; `logContext` and the underlying
 * Error's own message/stack are for the server-side log only. This split is
 * what stops an upstream error body (Python's `detail: str(e)`, a Mongo
 * duplicate-key value, a raw LLM error) from leaking into a client response --
 * AllExceptionsFilter reads `safeMessage`, never `message`.
 */
export abstract class AppError extends Error {
  abstract readonly code: ErrorCode;
  abstract readonly httpStatus: number;
  abstract readonly safeMessage: string;

  readonly logContext: Record<string, unknown> = {};
  readonly retryAfterSeconds?: number;

  constructor(message: string, logContext: Record<string, unknown> = {}) {
    super(message);
    this.name = this.constructor.name;
    this.logContext = logContext;
  }
}

export class ValidationFailedError extends AppError {
  readonly code = ErrorCode.VALIDATION_FAILED;
  readonly httpStatus = 400;
  readonly safeMessage: string;

  constructor(message: string, logContext: Record<string, unknown> = {}) {
    super(message, logContext);
    this.safeMessage = message;
  }
}

export class NotFoundAppError extends AppError {
  readonly code = ErrorCode.NOT_FOUND;
  readonly httpStatus = 404;
  readonly safeMessage: string;

  constructor(
    message = 'Resource not found',
    logContext: Record<string, unknown> = {},
  ) {
    super(message, logContext);
    this.safeMessage = message;
  }
}

export class UnauthorizedAppError extends AppError {
  readonly code = ErrorCode.UNAUTHORIZED;
  readonly httpStatus = 401;
  readonly safeMessage = 'Unauthorized';
}

export class ForbiddenAppError extends AppError {
  readonly code = ErrorCode.FORBIDDEN;
  readonly httpStatus = 403;
  readonly safeMessage = 'Forbidden';
}

export class RequestTimeoutAppError extends AppError {
  readonly code = ErrorCode.REQUEST_TIMEOUT;
  readonly httpStatus = 504;
  readonly safeMessage = 'The request took too long to complete';
}

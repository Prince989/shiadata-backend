import { AppError } from '@common/errors/app.error';
import { ErrorCode } from '@common/errors/error-codes.enum';

/**
 * Every error the gateway can throw. `safeMessage` never carries the raw
 * provider error, a prompt fragment, or a key -- callers get a description
 * of what happened, not why in provider-internal terms.
 */
export class LlmInputTooLargeError extends AppError {
  readonly code = ErrorCode.VALIDATION_FAILED;
  readonly httpStatus = 413;
  readonly safeMessage = 'The request is too large to process';
}

export class LlmBudgetExceededError extends AppError {
  readonly code = ErrorCode.RATE_LIMITED;
  readonly httpStatus = 429;
  readonly safeMessage = 'The daily AI usage budget has been reached';
  override readonly retryAfterSeconds: number;

  constructor(
    retryAfterSeconds: number,
    logContext: Record<string, unknown> = {},
  ) {
    super('LLM budget exceeded', logContext);
    this.retryAfterSeconds = retryAfterSeconds;
  }
}

export class LlmDeadlineExceededError extends AppError {
  readonly code = ErrorCode.REQUEST_TIMEOUT;
  readonly httpStatus = 504;
  readonly safeMessage = 'The AI request took too long to complete';
}

export class LlmOutputTruncatedError extends AppError {
  readonly code = ErrorCode.INTERNAL_ERROR;
  readonly httpStatus = 502;
  readonly safeMessage =
    'The AI response was too long for the configured limit';
}

export class LlmSchemaViolationError extends AppError {
  readonly code = ErrorCode.INTERNAL_ERROR;
  readonly httpStatus = 502;
  readonly safeMessage = 'The AI response did not match the expected format';
}

export class LlmAllProvidersFailedError extends AppError {
  readonly code = ErrorCode.INTERNAL_ERROR;
  readonly httpStatus = 502;
  readonly safeMessage = 'The AI service is temporarily unavailable';
}

/** The request itself was malformed (bad model id, invalid params) -- our fault, never retried. */
export class LlmBadRequestError extends AppError {
  readonly code = ErrorCode.VALIDATION_FAILED;
  readonly httpStatus = 400;
  readonly safeMessage = 'The AI request could not be processed';
}

/** Provider safety system declined the content -- never retried. */
export class LlmContentFilteredError extends AppError {
  readonly code = ErrorCode.VALIDATION_FAILED;
  readonly httpStatus = 422;
  readonly safeMessage =
    'The content could not be processed due to safety filters';
}

export class LlmNoHealthyKeysError extends AppError {
  readonly code = ErrorCode.INTERNAL_ERROR;
  readonly httpStatus = 503;
  readonly safeMessage = 'The AI service has no available capacity right now';
  override readonly retryAfterSeconds = 30;
}

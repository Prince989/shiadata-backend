/**
 * Stable, machine-readable error codes returned to clients under `code`.
 * Grows as new modules add their own AppError subclasses.
 */
export enum ErrorCode {
  VALIDATION_FAILED = 'VALIDATION_FAILED',
  NOT_FOUND = 'NOT_FOUND',
  UNAUTHORIZED = 'UNAUTHORIZED',
  FORBIDDEN = 'FORBIDDEN',
  DUPLICATE_KEY = 'DUPLICATE_KEY',
  RATE_LIMITED = 'RATE_LIMITED',
  INTERNAL_ERROR = 'INTERNAL_ERROR',
  REQUEST_TIMEOUT = 'REQUEST_TIMEOUT',
}

export type DataErrorKind =
  | 'offline'
  | 'backend_unavailable'
  | 'not_found'
  | 'ai_unavailable'
  | 'rate_limited'
  | 'search_unavailable'
  | 'timeout'
  | 'aborted'
  | 'bad_request'
  | 'bad_response'
  | 'server';

/** Typed error thrown by every adapter so the UI can render a precise, calm error state. */
export class DataError extends Error {
  readonly kind: DataErrorKind;
  readonly status: number | null;
  readonly retryAfterSeconds: number | null;

  constructor(kind: DataErrorKind, message: string, options: { status?: number | null; retryAfterSeconds?: number | null; cause?: unknown } = {}) {
    super(message, { cause: options.cause });
    this.name = 'DataError';
    this.kind = kind;
    this.status = options.status ?? null;
    this.retryAfterSeconds = options.retryAfterSeconds ?? null;
  }
}

export function isDataError(error: unknown): error is DataError {
  return error instanceof DataError;
}

export function toDataError(error: unknown): DataError {
  if (error instanceof DataError) return error;
  if (error instanceof DOMException && error.name === 'AbortError') {
    return new DataError('aborted', 'The request was cancelled.', { cause: error });
  }
  if (error instanceof TypeError) {
    return new DataError('offline', 'The archive could not be reached. Check your connection.', { cause: error });
  }
  return new DataError('server', error instanceof Error ? error.message : 'Unexpected error.', { cause: error });
}

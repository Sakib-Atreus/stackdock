/** Every dashboard API response uses one of these shapes. */
export interface ApiSuccess<T> {
  data: T;
}

export interface ApiErrorBody {
  error: {
    /** Stable machine-readable code, e.g. `VALIDATION_FAILED`, `UNAUTHORIZED`. */
    code: string;
    /** Safe human-readable message. Never contains secrets or stack traces. */
    message: string;
    /** Optional per-field validation messages. */
    fields?: Record<string, string[]>;
    /** Optional safe extra info, e.g. `retryAfterSeconds`. */
    details?: Record<string, string | number | boolean | null>;
  };
}

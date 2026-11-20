import { HttpException } from '@nestjs/common';

/**
 * An error whose code and message are safe to show the user, for any status
 * (including 5xx, whose messages the exception filter otherwise hides).
 * Never put secrets or raw provider responses into the message.
 */
export class AppError extends HttpException {
  constructor(
    status: number,
    readonly code: string,
    message: string,
    readonly details?: Record<string, string | number | boolean | null>,
  ) {
    super({ code, message, details }, status);
  }
}

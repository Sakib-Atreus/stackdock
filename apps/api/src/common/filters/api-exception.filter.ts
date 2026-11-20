import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import type { Response } from 'express';
import type { ApiErrorBody } from '@stackdock/shared';

const CODE_BY_STATUS: Record<number, string> = {
  400: 'VALIDATION_FAILED',
  401: 'UNAUTHORIZED',
  403: 'FORBIDDEN',
  404: 'NOT_FOUND',
  409: 'CONFLICT',
  429: 'RATE_LIMITED',
};

/**
 * Converts every error into the shared `ApiErrorBody` envelope.
 * Unknown errors become a generic 500: no stack traces or internal messages
 * are ever sent to the client.
 */
@Catch()
export class ApiExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(ApiExceptionFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const res = host.switchToHttp().getResponse<Response>();

    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      res.status(status).json(toErrorBody(status, exception.getResponse()));
      return;
    }

    // Log only the error name/message — never request headers or bodies.
    const err = exception instanceof Error ? exception : new Error('unknown');
    this.logger.error(`${err.name}: ${err.message}`, err.stack);
    res.status(HttpStatus.INTERNAL_SERVER_ERROR).json({
      error: { code: 'INTERNAL_ERROR', message: 'Something went wrong.' },
    } satisfies ApiErrorBody);
  }
}

export function toErrorBody(status: number, payload: unknown): ApiErrorBody {
  // AppError: code + message are explicitly safe, even for 5xx.
  if (
    typeof payload === 'object' &&
    payload !== null &&
    'code' in payload &&
    typeof payload.code === 'string' &&
    'message' in payload &&
    typeof payload.message === 'string'
  ) {
    const details =
      'details' in payload &&
      payload.details &&
      typeof payload.details === 'object'
        ? (payload.details as Record<string, string | number | boolean | null>)
        : undefined;
    return {
      error: {
        code: payload.code,
        message: payload.message,
        ...(details ? { details } : {}),
      },
    };
  }

  const code =
    CODE_BY_STATUS[status] ?? (status >= 500 ? 'INTERNAL_ERROR' : 'ERROR');

  // Validation errors: ["field: message", ...] → fields map.
  if (
    typeof payload === 'object' &&
    payload !== null &&
    'message' in payload &&
    Array.isArray(payload.message)
  ) {
    const fields: Record<string, string[]> = {};
    for (const raw of payload.message as unknown[]) {
      const text = String(raw);
      const idx = text.indexOf(': ');
      const key = idx > 0 ? text.slice(0, idx) : '_';
      const msg = idx > 0 ? text.slice(idx + 2) : text;
      (fields[key] ??= []).push(msg);
    }
    return { error: { code, message: 'Some fields are invalid.', fields } };
  }

  const message =
    typeof payload === 'string'
      ? payload
      : typeof payload === 'object' &&
          payload !== null &&
          'message' in payload &&
          typeof payload.message === 'string'
        ? payload.message
        : 'Request failed.';

  return {
    error: {
      code,
      message: status >= 500 ? 'Something went wrong.' : message,
    },
  };
}

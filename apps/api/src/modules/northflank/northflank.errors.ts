import { HttpStatus } from '@nestjs/common';
import { AppError } from '../../common/errors/app-error.js';

export type NorthflankErrorCode =
  | 'NF_UNAUTHORIZED'
  | 'NF_FORBIDDEN'
  | 'NF_NOT_FOUND'
  | 'NF_CONFLICT'
  | 'NF_RATE_LIMITED'
  | 'NF_UNAVAILABLE'
  | 'NF_TIMEOUT'
  | 'NF_NETWORK'
  | 'NF_BAD_RESPONSE'
  | 'NF_REQUEST_REJECTED';

/** Safe, user-facing messages. Never include provider response bodies. */
const MESSAGES: Record<NorthflankErrorCode, string> = {
  NF_UNAUTHORIZED:
    'Northflank rejected the API token. It may be invalid, expired or revoked.',
  NF_FORBIDDEN:
    'The Northflank API token lacks the permission for this action.',
  NF_NOT_FOUND: 'Northflank could not find that resource.',
  NF_CONFLICT:
    'Northflank reported a conflict. The resource may be busy; try again shortly.',
  NF_RATE_LIMITED: 'Northflank rate limit reached. Please wait and try again.',
  NF_UNAVAILABLE:
    'Northflank is not responding right now. Please try again later.',
  NF_TIMEOUT: 'Northflank took too long to respond.',
  NF_NETWORK: 'Could not reach Northflank.',
  NF_BAD_RESPONSE: 'Northflank returned an unexpected response.',
  NF_REQUEST_REJECTED: 'Northflank rejected the request.',
};

/** HTTP status our API returns for each provider error. */
const STATUS: Record<NorthflankErrorCode, number> = {
  NF_UNAUTHORIZED: HttpStatus.BAD_REQUEST,
  NF_FORBIDDEN: HttpStatus.FORBIDDEN,
  NF_NOT_FOUND: HttpStatus.NOT_FOUND,
  NF_CONFLICT: HttpStatus.CONFLICT,
  NF_RATE_LIMITED: HttpStatus.TOO_MANY_REQUESTS,
  NF_UNAVAILABLE: HttpStatus.BAD_GATEWAY,
  NF_TIMEOUT: HttpStatus.GATEWAY_TIMEOUT,
  NF_NETWORK: HttpStatus.BAD_GATEWAY,
  NF_BAD_RESPONSE: HttpStatus.BAD_GATEWAY,
  NF_REQUEST_REJECTED: HttpStatus.BAD_REQUEST,
};

export class NorthflankError extends AppError {
  constructor(
    readonly nfCode: NorthflankErrorCode,
    readonly retryAfterSeconds?: number,
  ) {
    super(
      STATUS[nfCode],
      nfCode,
      MESSAGES[nfCode],
      retryAfterSeconds !== undefined ? { retryAfterSeconds } : undefined,
    );
    this.name = 'NorthflankError';
  }
}

export function codeForStatus(status: number): NorthflankErrorCode {
  if (status === 401) return 'NF_UNAUTHORIZED';
  if (status === 403) return 'NF_FORBIDDEN';
  if (status === 404) return 'NF_NOT_FOUND';
  if (status === 409) return 'NF_CONFLICT';
  if (status === 429) return 'NF_RATE_LIMITED';
  if (status >= 500) return 'NF_UNAVAILABLE';
  return 'NF_REQUEST_REJECTED';
}

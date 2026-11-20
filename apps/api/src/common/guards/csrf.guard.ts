import {
  type CanActivate,
  type ExecutionContext,
  ForbiddenException,
  Inject,
  Injectable,
} from '@nestjs/common';
import type { Request } from 'express';
import { ENV, type Env } from '../../config/env.js';

export const CSRF_HEADER = 'x-requested-with';
export const CSRF_HEADER_VALUE = 'stackdock';
const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

/**
 * CSRF defence for cookie sessions (layered with SameSite=Lax cookies):
 * 1. State-changing requests must carry `X-Requested-With: stackdock`.
 *    Browsers can't add custom headers cross-site without a CORS preflight,
 *    and CORS only allows our own dev origin.
 * 2. If an `Origin` header is present it must be our own origin.
 */
@Injectable()
export class CsrfGuard implements CanActivate {
  constructor(@Inject(ENV) private readonly env: Env) {}

  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest<Request>();
    if (SAFE_METHODS.has(req.method)) return true;

    if (req.get(CSRF_HEADER) !== CSRF_HEADER_VALUE) {
      throw new ForbiddenException('Request rejected (missing CSRF header).');
    }

    const origin = req.get('origin');
    if (origin && !this.isAllowedOrigin(origin, req)) {
      throw new ForbiddenException('Request rejected (cross-origin).');
    }
    return true;
  }

  private isAllowedOrigin(origin: string, req: Request): boolean {
    if (
      this.env.NODE_ENV !== 'production' &&
      this.env.WEB_URL &&
      origin === new URL(this.env.WEB_URL).origin
    ) {
      return true;
    }
    try {
      return new URL(origin).host === req.get('host');
    } catch {
      return false;
    }
  }
}

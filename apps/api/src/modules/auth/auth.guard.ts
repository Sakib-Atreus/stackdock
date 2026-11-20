import {
  type CanActivate,
  type ExecutionContext,
  Inject,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import { IS_PUBLIC } from '../../common/decorators/public.decorator.js';
import { ENV, type Env } from '../../config/env.js';
import { readSessionToken } from './session-cookie.js';
import { SessionService } from './session.service.js';

/** Global guard: every route needs a valid session unless marked @Public(). */
@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly sessions: SessionService,
    @Inject(ENV) private readonly env: Env,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;

    const req = context.switchToHttp().getRequest<Request>();
    const token = readSessionToken(req, this.env);
    const session = token ? await this.sessions.validate(token) : null;
    if (!session) throw new UnauthorizedException('Please sign in.');

    req.auth = { user: session.user, sessionId: session.sessionId };
    return true;
  }
}

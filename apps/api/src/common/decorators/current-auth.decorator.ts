import {
  createParamDecorator,
  type ExecutionContext,
  UnauthorizedException,
} from '@nestjs/common';
import type { Request } from 'express';

export type AuthContext = NonNullable<Request['auth']>;

/** Injects the authenticated user + session id (guaranteed by AuthGuard). */
export const CurrentAuth = createParamDecorator(
  (_: unknown, ctx: ExecutionContext): AuthContext => {
    const auth = ctx.switchToHttp().getRequest<Request>().auth;
    if (!auth) throw new UnauthorizedException();
    return auth;
  },
);

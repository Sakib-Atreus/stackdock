import { parseCookie } from 'cookie';
import type { CookieOptions, Request, Response } from 'express';
import type { Env } from '../../config/env.js';

/**
 * Production uses the `__Host-` prefix: the browser then enforces Secure,
 * Path=/ and no Domain attribute, so the cookie can't be set by subdomains.
 */
export function sessionCookieName(env: Env): string {
  return env.NODE_ENV === 'production' ? '__Host-sd_session' : 'sd_session';
}

export function sessionCookieOptions(env: Env, expires: Date): CookieOptions {
  return {
    httpOnly: true,
    sameSite: 'lax',
    secure: env.NODE_ENV === 'production',
    path: '/',
    expires,
  };
}

export function readSessionToken(req: Request, env: Env): string | undefined {
  const header = req.headers.cookie;
  if (!header) return undefined;
  const value = parseCookie(header)[sessionCookieName(env)];
  // Tokens are 43-char base64url; reject anything else early.
  return value && /^[A-Za-z0-9_-]{43}$/.test(value) ? value : undefined;
}

export function setSessionCookie(
  res: Response,
  env: Env,
  token: string,
  expires: Date,
): void {
  res.cookie(sessionCookieName(env), token, sessionCookieOptions(env, expires));
}

export function clearSessionCookie(res: Response, env: Env): void {
  const { expires: _ignored, ...options } = sessionCookieOptions(
    env,
    new Date(0),
  );
  res.clearCookie(sessionCookieName(env), options);
}

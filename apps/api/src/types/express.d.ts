import type { SessionUser } from '@stackdock/shared';

declare global {
  namespace Express {
    interface Request {
      /** Set by AuthGuard for authenticated requests. */
      auth?: { user: SessionUser; sessionId: string };
    }
  }
}

export {};

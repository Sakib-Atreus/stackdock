import type { ApiErrorBody } from '@stackdock/shared';

/** Empty in production (same origin). In dev, points at the NestJS server. */
const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? '';

export const UNAUTHORIZED_EVENT = 'stackdock:unauthorized';

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly fields?: Record<string, string[]>,
  ) {
    super(message);
  }
}

/**
 * Calls the StackDock API. Sends the session cookie and the CSRF marker
 * header; parses the shared error envelope into `ApiError`.
 */
export async function apiFetch<T>(
  path: string,
  init: RequestInit = {},
): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${API_BASE}/api/v1${path}`, {
      ...init,
      credentials: 'include',
      headers: {
        'Content-Type': 'application/json',
        'X-Requested-With': 'stackdock',
        ...init.headers,
      },
    });
  } catch {
    throw new ApiError(0, 'NETWORK_ERROR', 'Could not reach the server.');
  }

  const body: unknown = await res.json().catch(() => null);
  if (res.status === 401 && !path.startsWith('/auth/login')) {
    // Session expired or missing: let the AuthProvider send us to /login.
    window.dispatchEvent(new Event(UNAUTHORIZED_EVENT));
  }
  if (!res.ok) {
    const err = (body as ApiErrorBody | null)?.error;
    throw new ApiError(
      res.status,
      err?.code ?? 'ERROR',
      err?.message ?? `Request failed (${res.status}).`,
      err?.fields,
    );
  }
  return body as T;
}

/** Shorthand for JSON mutations. */
export function apiSend<T>(
  method: 'POST' | 'PUT' | 'PATCH' | 'DELETE',
  path: string,
  body?: unknown,
): Promise<T> {
  return apiFetch<T>(path, {
    method,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

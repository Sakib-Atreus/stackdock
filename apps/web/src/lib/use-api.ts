'use client';

import { useCallback, useEffect, useState } from 'react';
import { ApiError, apiFetch } from './api';

export type ApiState<T> =
  | { status: 'loading' }
  | { status: 'error'; error: ApiError }
  | { status: 'success'; data: T };

/** Minimal GET hook with loading/error/success states and a retry function. */
export function useApi<T>(path: string) {
  const [state, setState] = useState<ApiState<T>>({ status: 'loading' });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setState({ status: 'loading' });
    apiFetch<T>(path)
      .then((data) => !cancelled && setState({ status: 'success', data }))
      .catch((error: unknown) => {
        if (cancelled) return;
        setState({
          status: 'error',
          error:
            error instanceof ApiError
              ? error
              : new ApiError(0, 'UNKNOWN', 'Unexpected error.'),
        });
      });
    return () => {
      cancelled = true;
    };
  }, [path, attempt]);

  const retry = useCallback(() => setAttempt((n) => n + 1), []);
  /** Replace the data locally (e.g. with a mutation's response). */
  const setData = useCallback(
    (data: T) => setState({ status: 'success', data }),
    [],
  );
  return { state, retry, setData };
}

'use client';

import type { ApiSuccess, SessionInfo, SessionUser } from '@stackdock/shared';
import { usePathname, useRouter } from 'next/navigation';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { apiFetch, apiSend, UNAUTHORIZED_EVENT } from '@/lib/api';

type AuthState =
  | { status: 'loading' }
  | { status: 'error' }
  | { status: 'signed-out' }
  | { status: 'signed-in'; user: SessionUser };

interface AuthContextValue {
  state: AuthState;
  signedIn: (user: SessionUser) => void;
  logout: () => Promise<void>;
  reload: () => void;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider');
  return ctx;
}

export const PUBLIC_PATHS = ['/login'];

/**
 * Asks the API who is signed in, and keeps the browser on /login until a
 * session exists. Real protection is server-side (every API route is guarded);
 * this only controls what the UI shows.
 */
export function AuthProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AuthState>({ status: 'loading' });
  const [attempt, setAttempt] = useState(0);
  const router = useRouter();
  const pathname = usePathname();
  const isPublic = PUBLIC_PATHS.includes(pathname);

  useEffect(() => {
    let cancelled = false;
    apiFetch<ApiSuccess<SessionInfo>>('/auth/session')
      .then(({ data }) => {
        if (cancelled) return;
        setState(
          data.user
            ? { status: 'signed-in', user: data.user }
            : { status: 'signed-out' },
        );
      })
      .catch(() => !cancelled && setState({ status: 'error' }));
    return () => {
      cancelled = true;
    };
  }, [attempt]);

  // Any 401 from the API means the session is gone.
  useEffect(() => {
    const onUnauthorized = () => setState({ status: 'signed-out' });
    window.addEventListener(UNAUTHORIZED_EVENT, onUnauthorized);
    return () => window.removeEventListener(UNAUTHORIZED_EVENT, onUnauthorized);
  }, []);

  useEffect(() => {
    if (state.status === 'signed-out' && !isPublic) {
      const next = window.location.pathname + window.location.search;
      router.replace(`/login?next=${encodeURIComponent(next)}`);
    }
  }, [state.status, isPublic, router]);

  const signedIn = useCallback(
    (user: SessionUser) => setState({ status: 'signed-in', user }),
    [],
  );

  const logout = useCallback(async () => {
    try {
      await apiSend('POST', '/auth/logout');
    } finally {
      setState({ status: 'signed-out' });
      router.replace('/login');
    }
  }, [router]);

  const reload = useCallback(() => {
    setState({ status: 'loading' });
    setAttempt((n) => n + 1);
  }, []);

  const value = useMemo(
    () => ({ state, signedIn, logout, reload }),
    [state, signedIn, logout, reload],
  );
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

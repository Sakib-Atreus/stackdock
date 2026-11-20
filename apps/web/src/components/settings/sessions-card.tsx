'use client';

import type { ActiveSession, ApiSuccess } from '@stackdock/shared';
import { Loader2, RefreshCw } from 'lucide-react';
import { useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { ApiError, apiSend } from '@/lib/api';
import { useApi } from '@/lib/use-api';

export function SessionsCard({ refreshKey }: { refreshKey: number }) {
  const { state, retry } = useApi<ApiSuccess<ActiveSession[]>>(
    `/auth/sessions?r=${refreshKey}`,
  );
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  async function revokeOthers() {
    setBusy(true);
    setMessage(null);
    try {
      const { data } = await apiSend<ApiSuccess<{ revoked: number }>>(
        'DELETE',
        '/auth/sessions/others',
      );
      setMessage(
        data.revoked === 0
          ? 'No other sessions.'
          : `Signed out ${data.revoked} other session${data.revoked === 1 ? '' : 's'}.`,
      );
      retry();
    } catch (err) {
      setMessage(
        err instanceof ApiError ? err.message : 'Something went wrong.',
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Active sessions</CardTitle>
        <CardDescription>
          Browsers currently signed in to StackDock.
        </CardDescription>
      </CardHeader>
      <CardContent className="grid gap-4" aria-live="polite">
        {state.status === 'loading' && (
          <Loader2
            className="size-4 animate-spin text-muted-foreground"
            aria-label="Loading"
          />
        )}
        {state.status === 'error' && (
          <div className="flex items-center gap-3 text-sm">
            <span className="text-muted-foreground">{state.error.message}</span>
            <Button variant="outline" size="sm" onClick={retry}>
              <RefreshCw /> Retry
            </Button>
          </div>
        )}
        {state.status === 'success' && (
          <ul className="divide-y rounded-lg border text-sm">
            {state.data.data.map((s) => (
              <li
                key={s.id}
                className="flex flex-col gap-1 p-3 sm:flex-row sm:items-center sm:justify-between"
              >
                <span
                  className="min-w-0 truncate"
                  title={s.userAgent ?? undefined}
                >
                  {describeAgent(s.userAgent)}
                  {s.current && (
                    <Badge variant="secondary" className="ml-2">
                      This browser
                    </Badge>
                  )}
                </span>
                <span className="text-xs text-muted-foreground">
                  Last active {new Date(s.lastSeenAt).toLocaleString()}
                </span>
              </li>
            ))}
          </ul>
        )}
        <div className="flex flex-wrap items-center gap-3">
          <Button variant="outline" onClick={revokeOthers} disabled={busy}>
            {busy && <Loader2 className="animate-spin" />}
            Sign out other sessions
          </Button>
          {message && (
            <span className="text-sm text-muted-foreground">{message}</span>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

function describeAgent(ua: string | null): string {
  if (!ua) return 'Unknown device';
  const browser = /Edg\//.test(ua)
    ? 'Edge'
    : /Chrome\//.test(ua)
      ? 'Chrome'
      : /Firefox\//.test(ua)
        ? 'Firefox'
        : /Safari\//.test(ua)
          ? 'Safari'
          : 'Browser';
  const os = /iPhone|iPad/.test(ua)
    ? 'iOS'
    : /Android/.test(ua)
      ? 'Android'
      : /Mac OS X/.test(ua)
        ? 'macOS'
        : /Windows/.test(ua)
          ? 'Windows'
          : /Linux/.test(ua)
            ? 'Linux'
            : 'unknown OS';
  return `${browser} on ${os}`;
}

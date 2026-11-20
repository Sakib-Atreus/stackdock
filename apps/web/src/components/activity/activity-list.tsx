'use client';

import type { ActivityItem, ActivityPage, ApiSuccess } from '@stackdock/shared';
import { Activity, Loader2, RefreshCw } from 'lucide-react';
import { useEffect, useState } from 'react';
import { EmptyState } from '@/components/layout/empty-state';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ApiError, apiFetch } from '@/lib/api';
import { formatDateTime } from '@/lib/format';

const LABELS: Record<string, string> = {
  'auth.login': 'Sign in',
  'auth.logout': 'Sign out',
  'auth.password_changed': 'Password changed',
  'auth.sessions_revoked': 'Other sessions signed out',
  'admin.created': 'Admin account created',
  'admin.password_reset': 'Password reset (CLI)',
  'provider.connected': 'Northflank connected',
  'provider.tested': 'Northflank connection tested',
  'provider.disconnected': 'Northflank disconnected',
  'secrets.reencrypted': 'Secrets re-encrypted',
};

export function ActivityList() {
  const [items, setItems] = useState<ActivityItem[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [status, setStatus] = useState<'loading' | 'idle' | 'error'>('loading');
  const [error, setError] = useState('');

  async function load(next: string | null, replace: boolean) {
    setStatus('loading');
    try {
      const qs = new URLSearchParams({ limit: '50' });
      if (next) qs.set('cursor', next);
      const { data } = await apiFetch<ApiSuccess<ActivityPage>>(
        `/activity?${qs}`,
      );
      setItems((prev) => (replace ? data.items : [...prev, ...data.items]));
      setCursor(data.nextCursor);
      setStatus('idle');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Something went wrong.');
      setStatus('error');
    }
  }

  useEffect(() => {
    void load(null, true);
  }, []);

  if (status === 'error' && items.length === 0) {
    return (
      <div className="flex items-center gap-3 text-sm">
        <span className="text-muted-foreground">{error}</span>
        <Button
          variant="outline"
          size="sm"
          onClick={() => void load(null, true)}
        >
          <RefreshCw /> Retry
        </Button>
      </div>
    );
  }
  if (status === 'loading' && items.length === 0) {
    return (
      <Loader2
        className="size-5 animate-spin text-muted-foreground"
        aria-label="Loading"
      />
    );
  }
  if (items.length === 0) {
    return (
      <EmptyState
        icon={Activity}
        title="No activity yet"
        description="Sign-ins, connections and deploys will be recorded here."
      />
    );
  }

  return (
    <div className="grid gap-4">
      <div className="flex justify-end">
        <Button
          variant="outline"
          size="sm"
          onClick={() => void load(null, true)}
        >
          <RefreshCw /> Refresh
        </Button>
      </div>
      <ul className="divide-y rounded-xl border text-sm">
        {items.map((item) => (
          <li
            key={item.id}
            className="flex flex-col gap-1 p-3 sm:flex-row sm:items-center sm:gap-4"
          >
            <span className="w-40 shrink-0 text-xs text-muted-foreground">
              {formatDateTime(item.createdAt)}
            </span>
            <span className="flex-1 font-medium">
              {LABELS[item.action] ?? item.action}
            </span>
            <span className="text-xs text-muted-foreground">
              {describe(item)}
            </span>
            <Badge
              variant={item.status === 'SUCCESS' ? 'secondary' : 'destructive'}
            >
              {item.status === 'SUCCESS' ? 'OK' : 'Failed'}
            </Badge>
          </li>
        ))}
      </ul>
      {cursor && (
        <Button
          variant="outline"
          className="justify-self-center"
          disabled={status === 'loading'}
          onClick={() => void load(cursor, false)}
        >
          {status === 'loading' && <Loader2 className="animate-spin" />}
          Load more
        </Button>
      )}
    </div>
  );
}

function describe(item: ActivityItem): string {
  const m = item.metadata;
  if (!m) return '';
  const parts: string[] = [];
  if (typeof m.ip === 'string') parts.push(`IP ${m.ip}`);
  if (typeof m.team === 'string') parts.push(`team ${m.team}`);
  if (typeof m.code === 'string') parts.push(m.code);
  if (typeof m.count === 'number') parts.push(`${m.count} session(s)`);
  return parts.join(' · ');
}

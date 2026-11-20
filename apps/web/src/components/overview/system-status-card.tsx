'use client';

import type { ApiSuccess, HealthResponse } from '@stackdock/shared';
import { Loader2, RefreshCw } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { useApi } from '@/lib/use-api';

export function SystemStatusCard() {
  const { state, retry } = useApi<ApiSuccess<HealthResponse>>('/health');

  return (
    <Card>
      <CardHeader>
        <CardTitle>System status</CardTitle>
        <CardDescription>StackDock API and database</CardDescription>
      </CardHeader>
      <CardContent aria-live="polite">
        {state.status === 'loading' && (
          <p className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="size-4 animate-spin" aria-hidden /> Checking…
          </p>
        )}

        {state.status === 'error' && (
          <div className="flex flex-wrap items-center gap-3">
            <Badge variant="destructive">Unreachable</Badge>
            <span className="text-sm text-muted-foreground">
              {state.error.status === 503
                ? 'Database is down.'
                : state.error.message}
            </span>
            <Button variant="outline" size="sm" onClick={retry}>
              <RefreshCw /> Retry
            </Button>
          </div>
        )}

        {state.status === 'success' && (
          <dl className="grid grid-cols-2 gap-y-2 text-sm sm:grid-cols-4">
            <dt className="text-muted-foreground">API</dt>
            <dd>
              <Badge variant="secondary">Online</Badge>
            </dd>
            <dt className="text-muted-foreground">Database</dt>
            <dd>
              <Badge
                variant={
                  state.data.data.checks.database === 'up'
                    ? 'secondary'
                    : 'destructive'
                }
              >
                {state.data.data.checks.database === 'up' ? 'Up' : 'Down'}
              </Badge>
            </dd>
            <dt className="text-muted-foreground">Version</dt>
            <dd className="font-mono">{state.data.data.version}</dd>
            <dt className="text-muted-foreground">Uptime</dt>
            <dd>{formatUptime(state.data.data.uptimeSeconds)}</dd>
          </dl>
        )}
      </CardContent>
    </Card>
  );
}

function formatUptime(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

'use client';

import type { ApiSuccess, DeploymentView } from '@stackdock/shared';
import { ChevronDown, ChevronRight, Loader2, X } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { ApiError, apiFetch, apiSend } from '@/lib/api';
import { formatRelative } from '@/lib/format';
import { usePolling } from '@/lib/use-polling';
import {
  DeploymentStatusBadge,
  isActiveDeployment,
} from './deployment-status-badge';
import { LogView } from './log-view';

export function DeploymentsCard({
  deployments,
  onChanged,
}: {
  deployments: DeploymentView[];
  onChanged: () => void;
}) {
  const [open, setOpen] = useState<string | null>(null);

  return (
    <Card>
      <CardHeader>
        <CardTitle>
          <h2>Deployments</h2>
        </CardTitle>
        <CardDescription>
          The latest 30 deploys. Secrets are hidden in logs.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {deployments.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No deployments yet. Press Deploy to start.
          </p>
        ) : (
          <ul className="divide-y rounded-lg border text-sm">
            {deployments.map((d, index) => {
              // The newest deploy stays open until you pick another one.
              const expanded = open === d.id || (open === null && index === 0);
              return (
                <li key={d.id}>
                  <button
                    onClick={() => setOpen(expanded ? '' : d.id)}
                    aria-expanded={expanded}
                    className="flex w-full flex-wrap items-center gap-3 p-3 text-left outline-none hover:bg-muted/40 focus-visible:ring-3 focus-visible:ring-ring/50"
                  >
                    {expanded ? (
                      <ChevronDown className="size-4" />
                    ) : (
                      <ChevronRight className="size-4" />
                    )}
                    <DeploymentStatusBadge status={d.status} />
                    <span className="font-mono text-xs">
                      {d.commitSha?.slice(0, 7) ?? '…'}
                    </span>
                    <span className="min-w-0 flex-1 truncate">
                      {d.commitMessage ?? d.branch}
                    </span>
                    <span className="text-xs text-muted-foreground">
                      {d.trigger === 'BOOT' ? 'auto (restart) · ' : ''}
                      {formatRelative(d.queuedAt)}
                      {duration(d)}
                    </span>
                  </button>
                  {expanded && (
                    <DeploymentDetail id={d.id} onChanged={onChanged} />
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

function DeploymentDetail({
  id,
  onChanged,
}: {
  id: string;
  onChanged: () => void;
}) {
  const [d, setD] = useState<DeploymentView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [cancelling, setCancelling] = useState(false);

  const load = async () => {
    try {
      const res = await apiFetch<ApiSuccess<DeploymentView>>(
        `/deployments/${id}`,
      );
      setD(res.data);
      setError(null);
    } catch (err) {
      setError(
        err instanceof ApiError ? err.message : 'Could not load the log.',
      );
    }
  };
  // Load once, then poll while it is still running.
  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);
  usePolling(load, 1_500, d !== null && isActiveDeployment(d.status));

  async function cancel() {
    setCancelling(true);
    try {
      await apiSend('POST', `/deployments/${id}/cancel`);
      onChanged();
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not cancel.');
    } finally {
      setCancelling(false);
    }
  }

  return (
    <div className="grid gap-2 border-t bg-muted/20 p-3">
      {error && <p className="text-sm text-destructive">{error}</p>}
      {d?.errorSummary && (
        <p className="text-sm text-destructive">{d.errorSummary}</p>
      )}
      {d && isActiveDeployment(d.status) && (
        <div>
          <Button
            size="sm"
            variant="outline"
            onClick={cancel}
            disabled={cancelling}
          >
            {cancelling ? <Loader2 className="animate-spin" /> : <X />}
            Cancel deployment
          </Button>
        </div>
      )}
      <LogView
        label="Build log"
        text={d?.log ?? ''}
        emptyText={d ? 'Waiting for output…' : 'Loading…'}
      />
    </div>
  );
}

function duration(d: DeploymentView): string {
  if (!d.startedAt || !d.finishedAt) return '';
  const s = Math.round(
    (new Date(d.finishedAt).getTime() - new Date(d.startedAt).getTime()) / 1000,
  );
  return ` · ${s < 60 ? `${s}s` : `${Math.floor(s / 60)}m ${s % 60}s`}`;
}

'use client';

import type { ApiSuccess, NfSelfView } from '@stackdock/shared';
import { ExternalLink, Loader2, RefreshCw } from 'lucide-react';
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

export function SelfServiceCard() {
  const { state, retry } = useApi<ApiSuccess<NfSelfView>>('/northflank/self');
  const self = state.status === 'success' ? state.data.data : null;

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between gap-3">
          <CardTitle>
            <h2>StackDock&apos;s own service</h2>
          </CardTitle>
          {self && (
            <Badge variant={self.onNorthflank ? 'secondary' : 'outline'}>
              {self.onNorthflank ? 'On Northflank' : 'Not on Northflank'}
            </Badge>
          )}
        </div>
        <CardDescription>
          Each project can get its own public port (and code.run URL) on this
          service.
        </CardDescription>
      </CardHeader>
      <CardContent className="grid gap-3 text-sm" aria-live="polite">
        {state.status === 'loading' && (
          <Loader2
            className="size-4 animate-spin text-muted-foreground"
            aria-label="Loading"
          />
        )}
        {state.status === 'error' && (
          <div className="flex items-center gap-3">
            <span className="text-muted-foreground">{state.error.message}</span>
            <Button variant="outline" size="sm" onClick={retry}>
              <RefreshCw /> Retry
            </Button>
          </div>
        )}
        {self && (
          <>
            {self.problem && (
              <p className="text-muted-foreground">{self.problem}</p>
            )}
            {self.onNorthflank && (
              <p className="text-muted-foreground">
                Project <span className="font-mono">{self.projectId}</span> ·
                service <span className="font-mono">{self.serviceId}</span>
                {self.serviceType ? ` (${self.serviceType})` : ''} · routing{' '}
                <span className="font-mono">{self.routingMode}</span>
              </p>
            )}
            {self.ports.length > 0 && (
              <ul className="divide-y rounded-lg border">
                {self.ports.map((p) => (
                  <li
                    key={p.name}
                    className="flex flex-wrap items-center gap-3 p-3"
                  >
                    <span className="font-mono">{p.name}</span>
                    <span className="text-xs text-muted-foreground">
                      :{p.internalPort}
                    </span>
                    <span className="flex-1" />
                    {p.url ? (
                      <a
                        href={p.url}
                        target="_blank"
                        rel="noreferrer noopener"
                        className="inline-flex items-center gap-1 break-all underline underline-offset-4"
                      >
                        {p.url.replace('https://', '').replace(/\/$/, '')}
                        <ExternalLink className="size-3" aria-hidden />
                      </a>
                    ) : (
                      <span className="text-xs text-muted-foreground">
                        {p.public
                          ? 'URL appears after StackDock restarts'
                          : 'private'}
                      </span>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}

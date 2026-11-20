'use client';

import type { ApiSuccess, ProviderConnectionView } from '@stackdock/shared';
import { Loader2, RefreshCw } from 'lucide-react';
import { useState } from 'react';
import { Alert, AlertDescription } from '@/components/ui/alert';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { ApiError, apiSend } from '@/lib/api';
import { formatDateTime, formatRelative } from '@/lib/format';
import { ConnectForm } from './connect-form';
import { ConnectionStatusBadge } from './connection-status-badge';
import { TokenHelp } from './token-help';
import { useNorthflankConnection } from './use-northflank-connection';

export function NorthflankConnectionCard() {
  const { state, connection, retry, update } = useNorthflankConnection();
  const [replacing, setReplacing] = useState(false);
  const [busy, setBusy] = useState<'test' | 'disconnect' | null>(null);
  const [notice, setNotice] = useState<{ ok: boolean; text: string } | null>(
    null,
  );
  const [confirmOpen, setConfirmOpen] = useState(false);

  async function run(
    kind: 'test' | 'disconnect',
    method: 'POST' | 'DELETE',
    path: string,
  ) {
    setBusy(kind);
    setNotice(null);
    try {
      const { data } = await apiSend<ApiSuccess<ProviderConnectionView>>(
        method,
        path,
      );
      update(data);
      if (kind === 'test') {
        setNotice(
          data.status === 'CONNECTED'
            ? { ok: true, text: 'Connection works.' }
            : {
                ok: false,
                text: data.lastErrorMessage ?? 'Connection failed.',
              },
        );
      } else {
        setNotice({ ok: true, text: 'Disconnected. The token was deleted.' });
      }
    } catch (err) {
      setNotice({
        ok: false,
        text: err instanceof ApiError ? err.message : 'Something went wrong.',
      });
    } finally {
      setBusy(null);
      setConfirmOpen(false);
    }
  }

  const onConnected = (view: ProviderConnectionView) => {
    update(view);
    setReplacing(false);
    setNotice({ ok: true, text: 'Northflank connected.' });
  };

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between gap-3">
          <CardTitle>Northflank connection</CardTitle>
          {state.status === 'success' && (
            <ConnectionStatusBadge connection={connection} />
          )}
        </div>
        <CardDescription>
          Lets StackDock read your Northflank projects and manage its own
          service. Quotas and billing stay controlled by Northflank.
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

        {notice && (
          <Alert variant={notice.ok ? 'default' : 'destructive'} role="status">
            <AlertDescription>{notice.text}</AlertDescription>
          </Alert>
        )}

        {state.status === 'success' && !connection?.connected && (
          <>
            <ConnectForm replacing={false} onConnected={onConnected} />
            <TokenHelp />
          </>
        )}

        {state.status === 'success' && connection?.connected && (
          <>
            {connection.status === 'ERROR' &&
              connection.lastErrorMessage &&
              !notice && (
                <Alert variant="destructive">
                  <AlertDescription>
                    {connection.lastErrorMessage}
                  </AlertDescription>
                </Alert>
              )}
            <dl className="grid grid-cols-[auto_1fr] gap-x-6 gap-y-2 text-sm sm:grid-cols-[auto_1fr_auto_1fr]">
              <Detail label="Token">
                {connection.account?.tokenName ?? 'Unnamed'}{' '}
                <span className="font-mono text-muted-foreground">
                  ••••{connection.tokenHint}
                </span>
              </Detail>
              <Detail label="Team">
                {connection.account?.entityId ?? '—'}
              </Detail>
              <Detail label="Role">
                {connection.account?.roleName ?? '—'}
              </Detail>
              <Detail label="Expires">
                {connection.account?.expiresAt
                  ? formatDateTime(connection.account.expiresAt)
                  : 'Never'}
              </Detail>
              <Detail label="Last tested">
                {formatRelative(connection.lastTestedAt)}
              </Detail>
              <Detail label="Connected">
                {formatDateTime(connection.connectedAt)}
              </Detail>
            </dl>

            {replacing ? (
              <ConnectForm
                replacing
                onConnected={onConnected}
                onCancel={() => setReplacing(false)}
              />
            ) : (
              <div className="flex flex-wrap gap-2">
                <Button
                  variant="outline"
                  disabled={busy !== null}
                  onClick={() =>
                    run('test', 'POST', '/providers/northflank/test')
                  }
                >
                  {busy === 'test' && <Loader2 className="animate-spin" />}
                  Test connection
                </Button>
                <Button variant="outline" onClick={() => setReplacing(true)}>
                  Replace token
                </Button>
                <Button
                  variant="destructive"
                  disabled={busy !== null}
                  onClick={() => setConfirmOpen(true)}
                >
                  Disconnect
                </Button>
              </div>
            )}
            <TokenHelp />
          </>
        )}
      </CardContent>

      <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Disconnect Northflank?</AlertDialogTitle>
            <AlertDialogDescription>
              StackDock deletes its stored copy of the API token. Nothing on
              Northflank is changed or deleted, and your services keep running.
              To fully revoke the token, delete it in Northflank too.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              disabled={busy !== null}
              onClick={() =>
                run('disconnect', 'DELETE', '/providers/northflank')
              }
            >
              {busy === 'disconnect' && <Loader2 className="animate-spin" />}
              Disconnect
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  );
}

function Detail({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <>
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="min-w-0 truncate">{children}</dd>
    </>
  );
}

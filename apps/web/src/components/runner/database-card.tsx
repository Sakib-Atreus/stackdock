'use client';

import type { ApiSuccess, ProjectDatabaseView } from '@stackdock/shared';
import { Database, Loader2, RefreshCw } from 'lucide-react';
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
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { ApiError, apiSend } from '@/lib/api';
import { formatDateTime } from '@/lib/format';
import { useApi } from '@/lib/use-api';

export function DatabaseCard({
  slug,
  readOnly,
}: {
  slug: string;
  readOnly: boolean;
}) {
  const { state, retry, setData } = useApi<ApiSuccess<ProjectDatabaseView>>(
    `/projects/${slug}/database`,
  );
  const [dialog, setDialog] = useState<'create' | 'drop' | null>(null);
  const [confirmText, setConfirmText] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(
    null,
  );

  async function act(kind: 'create' | 'drop') {
    setBusy(true);
    setMessage(null);
    try {
      const res =
        kind === 'create'
          ? await apiSend<ApiSuccess<ProjectDatabaseView>>(
              'POST',
              `/projects/${slug}/database`,
            )
          : await apiSend<ApiSuccess<ProjectDatabaseView>>(
              'DELETE',
              `/projects/${slug}/database`,
              {
                confirmSlug: confirmText,
              },
            );
      setData(res);
      setMessage({
        ok: true,
        text:
          kind === 'create'
            ? 'Database created. Redeploy to give the app its DATABASE_URL.'
            : 'Database deleted.',
      });
      setDialog(null);
    } catch (err) {
      setMessage({
        ok: false,
        text: err instanceof ApiError ? err.message : 'Something went wrong.',
      });
      setDialog(null);
    } finally {
      setBusy(false);
    }
  }

  const db = state.status === 'success' ? state.data.data : null;

  return (
    <Card>
      <CardHeader>
        <CardTitle>
          <h2>Database</h2>
        </CardTitle>
        <CardDescription>
          A private Postgres database just for this project, inside
          StackDock&apos;s Postgres. The app receives it as{' '}
          <code className="font-mono">DATABASE_URL</code>.
        </CardDescription>
      </CardHeader>
      <CardContent className="grid gap-4" aria-live="polite">
        {message && (
          <Alert variant={message.ok ? 'default' : 'destructive'} role="status">
            <AlertDescription>{message.text}</AlertDescription>
          </Alert>
        )}
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
        {db && !db.exists && (
          <div className="flex flex-wrap items-center gap-3">
            <p className="flex items-center gap-2 text-sm text-muted-foreground">
              <Database className="size-4" aria-hidden /> No database.
            </p>
            {!readOnly && (
              <Button variant="outline" onClick={() => setDialog('create')}>
                Create database
              </Button>
            )}
          </div>
        )}
        {db?.exists && (
          <>
            {db.overriddenByEnv && (
              <Alert>
                <AlertDescription>
                  This project sets its own DATABASE_URL variable, which is used
                  instead of this database.
                </AlertDescription>
              </Alert>
            )}
            <dl className="grid grid-cols-[auto_1fr] gap-x-6 gap-y-2 text-sm">
              <dt className="text-muted-foreground">Database</dt>
              <dd className="font-mono">{db.dbName}</dd>
              <dt className="text-muted-foreground">User</dt>
              <dd className="font-mono">{db.roleName}</dd>
              <dt className="text-muted-foreground">Host</dt>
              <dd className="font-mono">{db.host}</dd>
              <dt className="text-muted-foreground">Password</dt>
              <dd>Encrypted; only given to the app</dd>
              <dt className="text-muted-foreground">Created</dt>
              <dd>{formatDateTime(db.createdAt)}</dd>
            </dl>
            <div>
              <Button
                variant="destructive"
                onClick={() => {
                  setConfirmText('');
                  setDialog('drop');
                }}
              >
                Delete database
              </Button>
            </div>
          </>
        )}
      </CardContent>

      <AlertDialog
        open={dialog === 'create'}
        onOpenChange={(o) => !o && setDialog(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Create a database?</AlertDialogTitle>
            <AlertDialogDescription>
              Creates database proj_{slug.replace(/-/g, '_')} with its own user.
              It shares the storage and CPU of StackDock&apos;s Postgres.
              Redeploy afterwards so the app gets DATABASE_URL.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction disabled={busy} onClick={() => act('create')}>
              {busy && <Loader2 className="animate-spin" />}
              Create
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog
        open={dialog === 'drop'}
        onOpenChange={(o) => !o && setDialog(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              Delete the database and all its data?
            </AlertDialogTitle>
            <AlertDialogDescription>
              The database and its user are dropped permanently. This cannot be
              undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div className="grid gap-2">
            <Label htmlFor="confirm-db">
              Type <span className="font-mono">{slug}</span> to confirm
            </Label>
            <Input
              id="confirm-db"
              value={confirmText}
              onChange={(e) => setConfirmText(e.target.value)}
              autoComplete="off"
            />
          </div>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              disabled={busy || confirmText !== slug}
              onClick={() => act('drop')}
            >
              {busy && <Loader2 className="animate-spin" />}
              Delete database
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  );
}

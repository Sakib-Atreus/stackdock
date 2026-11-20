'use client';

import type {
  ApiSuccess,
  ExposeResult,
  NfSelfView,
  ProjectView,
} from '@stackdock/shared';
import { ExternalLink, Globe, Loader2 } from 'lucide-react';
import { useState } from 'react';
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
import { ApiError, apiFetch, apiSend } from '@/lib/api';

/**
 * The project's own public URL: a Northflank port named after the project on
 * StackDock's service (D-15). Changing ports redeploys StackDock.
 */
export function OwnUrl({
  project,
  onChanged,
}: {
  project: ProjectView;
  onChanged: () => void;
}) {
  const [dialog, setDialog] = useState<'add' | 'remove' | null>(null);
  const [self, setSelf] = useState<NfSelfView | null>(null);
  const [checking, setChecking] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(
    null,
  );

  async function open(kind: 'add' | 'remove') {
    setMessage(null);
    setDialog(kind);
    if (kind === 'add') {
      setChecking(true);
      try {
        setSelf(
          (await apiFetch<ApiSuccess<NfSelfView>>('/northflank/self')).data,
        );
      } catch (err) {
        setSelf(null);
        setMessage({
          ok: false,
          text:
            err instanceof ApiError
              ? err.message
              : 'Could not check Northflank.',
        });
      } finally {
        setChecking(false);
      }
    }
  }

  async function run(kind: 'add' | 'remove') {
    setBusy(true);
    try {
      const { data } = await apiSend<ApiSuccess<ExposeResult>>(
        kind === 'add' ? 'POST' : 'DELETE',
        `/projects/${project.slug}/expose`,
      );
      setMessage({
        ok: true,
        text: data.restarting
          ? 'Northflank is applying the change and restarting StackDock. This page reconnects in about a minute.'
          : kind === 'add'
            ? 'The port already exists.'
            : 'Removed.',
      });
      onChanged();
    } catch (err) {
      setMessage({
        ok: false,
        text: err instanceof ApiError ? err.message : 'Something went wrong.',
      });
    } finally {
      setBusy(false);
      setDialog(null);
    }
  }

  const blocked = self?.problem ?? null;

  return (
    <div className="grid gap-1">
      {project.ownUrl ? (
        <span className="flex flex-wrap items-center gap-2">
          <a
            href={project.ownUrl}
            target="_blank"
            rel="noreferrer noopener"
            className="inline-flex items-center gap-1 break-all underline underline-offset-4"
          >
            {project.ownUrl.replace('https://', '').replace(/\/$/, '')}
            <ExternalLink className="size-3" aria-hidden />
          </a>
          <Button size="xs" variant="ghost" onClick={() => void open('remove')}>
            Remove
          </Button>
        </span>
      ) : project.exposed ? (
        <span className="flex flex-wrap items-center gap-2 text-muted-foreground">
          Port added; the URL appears after StackDock restarts.
          <Button size="xs" variant="ghost" onClick={() => void open('remove')}>
            Remove
          </Button>
        </span>
      ) : (
        <span>
          <Button
            size="xs"
            variant="outline"
            disabled={Boolean(project.archivedAt)}
            onClick={() => void open('add')}
          >
            <Globe /> Get own URL
          </Button>
        </span>
      )}
      {message && (
        <span
          role="status"
          className={
            message.ok
              ? 'text-xs text-muted-foreground'
              : 'text-xs text-destructive'
          }
        >
          {message.text}
        </span>
      )}

      <AlertDialog
        open={dialog === 'add'}
        onOpenChange={(o) => !o && setDialog(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              Give {project.name} its own URL?
            </AlertDialogTitle>
            <AlertDialogDescription>
              StackDock adds a public port named{' '}
              <span className="font-mono">{project.slug}</span> to its
              Northflank service, giving the project a URL like{' '}
              <span className="font-mono">{project.slug}--…code.run</span>.
              Northflank then
              <strong> restarts StackDock</strong>, so all projects briefly
              restart (about a minute).
            </AlertDialogDescription>
          </AlertDialogHeader>
          {checking && (
            <Loader2
              className="size-4 animate-spin text-muted-foreground"
              aria-label="Checking"
            />
          )}
          {blocked && <p className="text-sm text-destructive">{blocked}</p>}
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              disabled={busy || checking || !self || Boolean(blocked)}
              onClick={() => void run('add')}
            >
              {busy && <Loader2 className="animate-spin" />}
              Add port and restart
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog
        open={dialog === 'remove'}
        onOpenChange={(o) => !o && setDialog(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              Remove {project.name}&apos;s own URL?
            </AlertDialogTitle>
            <AlertDialogDescription>
              The public port <span className="font-mono">{project.slug}</span>{' '}
              is removed from StackDock&apos;s Northflank service, which
              restarts StackDock. The project stays reachable at{' '}
              <span className="font-mono">{project.pathUrl}</span>.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              disabled={busy}
              onClick={() => void run('remove')}
            >
              {busy && <Loader2 className="animate-spin" />}
              Remove port and restart
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

'use client';

import {
  RUNTIME_DEFAULTS,
  RUNTIME_LABELS,
  type ApiSuccess,
  type ProjectView,
} from '@stackdock/shared';
import {
  ArrowLeft,
  ExternalLink,
  Loader2,
  Pencil,
  RefreshCw,
} from 'lucide-react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useState, type ReactNode } from 'react';
import { PageHeader } from '@/components/layout/page-header';
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
import { LinkButton } from '@/components/ui/link-button';
import { ApiError, apiSend } from '@/lib/api';
import { formatDateTime } from '@/lib/format';
import { useApi } from '@/lib/use-api';
import { EnvVarsCard } from './env-vars-card';
import { ProjectStatusBadge } from './project-status-badge';

type Dialog = 'archive' | 'delete' | null;

export function ProjectDetail() {
  const slug = useSearchParams().get('slug') ?? '';
  const router = useRouter();
  const { state, retry, setData } = useApi<ApiSuccess<ProjectView>>(
    `/projects/${encodeURIComponent(slug)}`,
  );
  const [dialog, setDialog] = useState<Dialog>(null);
  const [busy, setBusy] = useState(false);
  const [confirmText, setConfirmText] = useState('');
  const [error, setError] = useState<string | null>(null);

  if (!slug) return <BackLink />;
  if (state.status === 'loading') {
    return (
      <Loader2
        className="size-5 animate-spin text-muted-foreground"
        aria-label="Loading"
      />
    );
  }
  if (state.status === 'error') {
    return (
      <div className="grid gap-4">
        <BackLink />
        <div className="flex items-center gap-3 text-sm">
          <span className="text-muted-foreground">
            {state.error.status === 404
              ? 'This project does not exist.'
              : state.error.message}
          </span>
          {state.error.status !== 404 && (
            <Button variant="outline" size="sm" onClick={retry}>
              <RefreshCw /> Retry
            </Button>
          )}
        </div>
      </div>
    );
  }

  const p = state.data.data;
  const isArchived = Boolean(p.archivedAt);
  const defaults = p.runtime === 'AUTO' ? null : RUNTIME_DEFAULTS[p.runtime];

  async function act(path: string, method: 'POST' | 'DELETE', body?: unknown) {
    setBusy(true);
    setError(null);
    try {
      if (method === 'DELETE') {
        await apiSend('DELETE', path, body);
        router.replace('/projects');
        return;
      }
      const { data } = await apiSend<ApiSuccess<ProjectView>>('POST', path);
      setData({ data });
      setDialog(null);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Something went wrong.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="grid gap-6">
      <BackLink />
      <PageHeader
        title={p.name}
        description={p.description ?? undefined}
        actions={
          <div className="flex flex-wrap gap-2">
            {!isArchived && (
              <LinkButton
                variant="outline"
                href={`/projects/edit?slug=${p.slug}`}
              >
                <Pencil /> Edit
              </LinkButton>
            )}
            {isArchived ? (
              <>
                <Button
                  variant="outline"
                  disabled={busy}
                  onClick={() => act(`/projects/${p.slug}/restore`, 'POST')}
                >
                  Restore
                </Button>
                <Button
                  variant="destructive"
                  onClick={() => {
                    setConfirmText('');
                    setError(null);
                    setDialog('delete');
                  }}
                >
                  Delete permanently
                </Button>
              </>
            ) : (
              <Button
                variant="outline"
                onClick={() => {
                  setError(null);
                  setDialog('archive');
                }}
              >
                Archive
              </Button>
            )}
          </div>
        }
      />

      {error && !dialog && (
        <Alert variant="destructive" role="alert">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}
      {isArchived && (
        <Alert>
          <AlertDescription>
            Archived on {formatDateTime(p.archivedAt)}. It is hidden from the
            project list and won&apos;t run. Restore it to make changes.
          </AlertDescription>
        </Alert>
      )}

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between gap-3">
              <CardTitle>
                <h2>Status</h2>
              </CardTitle>
              <ProjectStatusBadge status={p.status} archived={isArchived} />
            </div>
            <CardDescription>Deploying arrives in Phase 5.</CardDescription>
          </CardHeader>
          <CardContent>
            <Details>
              <Row label="Short name">
                <span className="font-mono">{p.slug}</span>
              </Row>
              <Row label="URL (fallback)">
                <span className="font-mono">{p.pathUrl}</span>
              </Row>
              <Row label="Own URL">
                Added when deployed on Northflank (Phase 6)
              </Row>
              <Row label="Last deployed">
                {formatDateTime(p.lastDeployedAt)}
              </Row>
              <Row label="Created">{formatDateTime(p.createdAt)}</Row>
            </Details>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>
              <h2>Source &amp; build</h2>
            </CardTitle>
          </CardHeader>
          <CardContent>
            <Details>
              <Row label="Repository">
                <a
                  href={p.repoUrl}
                  target="_blank"
                  rel="noreferrer noopener"
                  className="inline-flex items-center gap-1 underline underline-offset-4"
                >
                  {p.repoUrl.replace('https://github.com/', '')}
                  <ExternalLink className="size-3" aria-hidden />
                </a>
              </Row>
              <Row label="Branch">
                <span className="font-mono">{p.branch}</span>
              </Row>
              <Row label="Folder">
                <span className="font-mono">{p.rootDir}</span>
              </Row>
              <Row label="Language">{RUNTIME_LABELS[p.runtime]}</Row>
              <Row label="Install">
                <Cmd value={p.installCommand} fallback={defaults?.install} />
              </Row>
              <Row label="Build">
                <Cmd value={p.buildCommand} fallback={defaults?.build} />
              </Row>
              <Row label="Start">
                <Cmd value={p.startCommand} fallback={defaults?.start} />
              </Row>
              <Row label="Health check">
                <span className="font-mono">{p.healthCheckPath ?? '—'}</span>
              </Row>
            </Details>
          </CardContent>
        </Card>
      </div>

      <EnvVarsCard slug={p.slug} readOnly={isArchived} />

      <AlertDialog
        open={dialog === 'archive'}
        onOpenChange={(o) => !o && setDialog(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Archive {p.name}?</AlertDialogTitle>
            <AlertDialogDescription>
              The project is removed from the dashboard list and stopped in
              StackDock. Its settings and variables are kept, so you can restore
              it later. Nothing on Northflank or GitHub is deleted.
            </AlertDialogDescription>
          </AlertDialogHeader>
          {error && <p className="text-sm text-destructive">{error}</p>}
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              disabled={busy}
              onClick={() => act(`/projects/${p.slug}/archive`, 'POST')}
            >
              {busy && <Loader2 className="animate-spin" />}
              Archive
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog
        open={dialog === 'delete'}
        onOpenChange={(o) => !o && setDialog(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete {p.name} permanently?</AlertDialogTitle>
            <AlertDialogDescription>
              This deletes the project record and its environment variables from
              StackDock. It can&apos;t be undone. Your GitHub repository and any
              Northflank resources are not touched.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div className="grid gap-2">
            <Label htmlFor="confirm-slug">
              Type <span className="font-mono">{p.slug}</span> to confirm
            </Label>
            <Input
              id="confirm-slug"
              value={confirmText}
              onChange={(e) => setConfirmText(e.target.value)}
              autoComplete="off"
              spellCheck={false}
            />
            {error && <p className="text-sm text-destructive">{error}</p>}
          </div>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              disabled={busy || confirmText !== p.slug}
              onClick={() =>
                act(`/projects/${p.slug}`, 'DELETE', {
                  confirmSlug: confirmText,
                })
              }
            >
              {busy && <Loader2 className="animate-spin" />}
              Delete permanently
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function BackLink() {
  return (
    <Link
      href="/projects"
      className="inline-flex w-fit items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
    >
      <ArrowLeft className="size-4" aria-hidden /> Projects
    </Link>
  );
}

function Details({ children }: { children: ReactNode }) {
  return (
    <dl className="grid grid-cols-[auto_1fr] gap-x-6 gap-y-2 text-sm">
      {children}
    </dl>
  );
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <>
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="min-w-0 break-words">{children}</dd>
    </>
  );
}

function Cmd({ value, fallback }: { value: string | null; fallback?: string }) {
  if (value) return <code className="font-mono">{value}</code>;
  if (fallback)
    return (
      <span className="text-muted-foreground">
        <code className="font-mono">{fallback}</code> (default)
      </span>
    );
  if (fallback === '')
    return <span className="text-muted-foreground">None</span>;
  return <span className="text-muted-foreground">Auto-detected</span>;
}

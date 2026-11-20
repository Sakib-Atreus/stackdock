'use client';

import type {
  ApiSuccess,
  DeploymentView,
  ProjectView,
} from '@stackdock/shared';
import {
  ExternalLink,
  Loader2,
  Play,
  RotateCw,
  Rocket,
  Square,
} from 'lucide-react';
import { useState, type ReactNode } from 'react';
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
import { ProjectStatusBadge } from '@/components/projects/project-status-badge';
import { ApiError, apiSend } from '@/lib/api';
import { OwnUrl } from './own-url';
import { formatDateTime } from '@/lib/format';

type Action = 'deploy' | 'stop' | 'restart';

export function DeployPanel({
  project,
  activeDeployment,
  onChanged,
}: {
  project: ProjectView;
  activeDeployment: DeploymentView | null;
  onChanged: () => void;
}) {
  const [busy, setBusy] = useState<Action | null>(null);
  const [confirmStop, setConfirmStop] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(
    null,
  );
  const archived = Boolean(project.archivedAt);
  const running = project.status === 'RUNNING';
  const deploying = Boolean(activeDeployment);

  async function run(action: Action) {
    setBusy(action);
    setMessage(null);
    try {
      await apiSend<ApiSuccess<unknown>>(
        'POST',
        `/projects/${project.slug}/${action}`,
      );
      setMessage({
        ok: true,
        text:
          action === 'deploy'
            ? 'Deployment queued. Follow progress below.'
            : action === 'stop'
              ? 'Stopped.'
              : 'Restarted.',
      });
      onChanged();
    } catch (err) {
      setMessage({
        ok: false,
        text: err instanceof ApiError ? err.message : 'Something went wrong.',
      });
    } finally {
      setBusy(null);
      setConfirmStop(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between gap-3">
          <CardTitle>
            <h2>Deployment</h2>
          </CardTitle>
          <ProjectStatusBadge status={project.status} archived={archived} />
        </div>
        <CardDescription>
          Deploys clone the branch, build, and switch traffic only once the new
          version is healthy.
        </CardDescription>
      </CardHeader>
      <CardContent className="grid gap-4" aria-live="polite">
        {message && (
          <Alert variant={message.ok ? 'default' : 'destructive'} role="status">
            <AlertDescription>{message.text}</AlertDescription>
          </Alert>
        )}
        <div className="flex flex-wrap gap-2">
          <Button
            disabled={archived || deploying || busy !== null}
            onClick={() => run('deploy')}
          >
            {busy === 'deploy' || deploying ? (
              <Loader2 className="animate-spin" />
            ) : (
              <Rocket />
            )}
            {deploying ? 'Deploying…' : running ? 'Redeploy' : 'Deploy'}
          </Button>
          {running && (
            <>
              <Button
                variant="outline"
                disabled={busy !== null}
                onClick={() => run('restart')}
              >
                {busy === 'restart' ? (
                  <Loader2 className="animate-spin" />
                ) : (
                  <RotateCw />
                )}
                Restart
              </Button>
              <Button
                variant="outline"
                disabled={busy !== null}
                onClick={() => setConfirmStop(true)}
              >
                <Square /> Stop
              </Button>
            </>
          )}
          {!running && !deploying && project.status === 'STOPPED' && (
            <Button
              variant="outline"
              disabled={busy !== null}
              onClick={() => run('restart')}
            >
              {busy === 'restart' ? (
                <Loader2 className="animate-spin" />
              ) : (
                <Play />
              )}
              Start last build
            </Button>
          )}
          {running && (
            <a
              href={project.pathUrl}
              target="_blank"
              rel="noreferrer noopener"
              className="inline-flex h-8 items-center gap-1.5 rounded-lg px-2.5 text-sm font-medium underline-offset-4 hover:underline"
            >
              Open app <ExternalLink className="size-3.5" aria-hidden />
            </a>
          )}
        </div>
        <dl className="grid grid-cols-[auto_1fr] gap-x-6 gap-y-2 text-sm">
          <Row label="URL">
            <span className="font-mono">{project.pathUrl}</span>
          </Row>
          <Row label="Commit">
            <span className="font-mono">
              {project.lastCommitSha?.slice(0, 7) ?? '—'}
            </span>
          </Row>
          <Row label="Last deployed">
            {formatDateTime(project.lastDeployedAt)}
          </Row>
          <Row label="Own URL">
            <OwnUrl project={project} onChanged={onChanged} />
          </Row>
        </dl>
      </CardContent>

      <AlertDialog open={confirmStop} onOpenChange={setConfirmStop}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Stop {project.name}?</AlertDialogTitle>
            <AlertDialogDescription>
              The app goes offline. Visitors see a "not running" page until you
              start or deploy it again. Its build and data are kept.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              disabled={busy !== null}
              onClick={() => run('stop')}
            >
              {busy === 'stop' && <Loader2 className="animate-spin" />}
              Stop
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
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

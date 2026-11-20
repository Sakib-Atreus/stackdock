'use client';

import {
  type ApiSuccess,
  type NfProjectView,
  type NfServiceDetailView,
  type NfServiceView,
} from '@stackdock/shared';
import { Hammer, Loader2, RefreshCw } from 'lucide-react';
import { useEffect, useState } from 'react';
import { NativeSelect } from '@/components/projects/native-select';
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
import { ApiError, apiFetch, apiSend } from '@/lib/api';
import { formatRelative } from '@/lib/format';
import { usePolling } from '@/lib/use-polling';
import { NfStatusBadge } from './build-status-badge';

type Load<T> =
  | { status: 'idle' | 'loading' }
  | { status: 'error'; message: string }
  | { status: 'ok'; data: T };

export function ServicesBrowser() {
  const [projects, setProjects] = useState<Load<NfProjectView[]>>({
    status: 'loading',
  });
  const [projectId, setProjectId] = useState('');
  const [services, setServices] = useState<Load<NfServiceView[]>>({
    status: 'idle',
  });
  const [serviceId, setServiceId] = useState<string | null>(null);

  async function loadProjects(refresh = false) {
    setProjects({ status: 'loading' });
    try {
      const { data } = await apiFetch<ApiSuccess<NfProjectView[]>>(
        `/northflank/projects?refresh=${refresh}`,
      );
      setProjects({ status: 'ok', data });
      setProjectId((current) => current || data[0]?.id || '');
    } catch (err) {
      setProjects({
        status: 'error',
        message:
          err instanceof ApiError ? err.message : 'Could not load projects.',
      });
    }
  }

  async function loadServices(id: string, refresh = false) {
    if (!id) return;
    setServices({ status: 'loading' });
    try {
      const { data } = await apiFetch<ApiSuccess<NfServiceView[]>>(
        `/northflank/projects/${id}/services?refresh=${refresh}`,
      );
      setServices({ status: 'ok', data });
    } catch (err) {
      setServices({
        status: 'error',
        message:
          err instanceof ApiError ? err.message : 'Could not load services.',
      });
    }
  }

  useEffect(() => {
    void loadProjects();
  }, []);
  useEffect(() => {
    setServiceId(null);
    void loadServices(projectId);
  }, [projectId]);

  if (projects.status === 'error') {
    return (
      <Card>
        <CardContent className="flex flex-wrap items-center gap-3 text-sm">
          <span className="text-muted-foreground">{projects.message}</span>
          <Button
            variant="outline"
            size="sm"
            onClick={() => void loadProjects(true)}
          >
            <RefreshCw /> Retry
          </Button>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>
          <h2>Projects &amp; services</h2>
        </CardTitle>
        <CardDescription>
          Read from the Northflank API (refreshed every 15 s at most, to stay
          within its 1000 requests/hour limit).
        </CardDescription>
      </CardHeader>
      <CardContent className="grid gap-4">
        <div className="flex flex-wrap items-end gap-3">
          <div className="grid min-w-56 flex-1 gap-1.5 sm:flex-none">
            <Label htmlFor="nf-project">Northflank project</Label>
            <NativeSelect
              id="nf-project"
              value={projectId}
              onChange={(e) => setProjectId(e.target.value)}
              disabled={projects.status !== 'ok'}
            >
              {projects.status === 'ok' &&
                projects.data.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
            </NativeSelect>
          </div>
          <Button
            variant="outline"
            onClick={() => {
              void loadProjects(true);
              void loadServices(projectId, true);
            }}
          >
            <RefreshCw /> Refresh
          </Button>
        </div>

        {projects.status === 'ok' && projects.data.length === 0 && (
          <p className="text-sm text-muted-foreground">
            This token can&apos;t see any projects.
          </p>
        )}
        {(projects.status === 'loading' || services.status === 'loading') && (
          <Loader2
            className="size-4 animate-spin text-muted-foreground"
            aria-label="Loading"
          />
        )}
        {services.status === 'error' && (
          <p className="text-sm text-destructive">{services.message}</p>
        )}
        {services.status === 'ok' && services.data.length === 0 && (
          <p className="text-sm text-muted-foreground">
            No services in this project.
          </p>
        )}
        {services.status === 'ok' && services.data.length > 0 && (
          <ul className="divide-y rounded-lg border text-sm">
            {services.data.map((s) => (
              <li key={s.id}>
                <button
                  onClick={() => setServiceId(serviceId === s.id ? null : s.id)}
                  aria-expanded={serviceId === s.id}
                  className="flex w-full flex-wrap items-center gap-3 p-3 text-left outline-none hover:bg-muted/40 focus-visible:ring-3 focus-visible:ring-ring/50"
                >
                  <span className="min-w-0 flex-1 truncate font-medium">
                    {s.name}
                  </span>
                  <span className="text-xs text-muted-foreground">
                    {s.type}
                  </span>
                  {s.type !== 'deployment' && (
                    <NfStatusBadge status={s.buildStatus} />
                  )}
                  <NfStatusBadge status={s.deploymentStatus} />
                </button>
                {serviceId === s.id && (
                  <ServiceDetail projectId={projectId} serviceId={s.id} />
                )}
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

function ServiceDetail({
  projectId,
  serviceId,
}: {
  projectId: string;
  serviceId: string;
}) {
  const [detail, setDetail] = useState<Load<NfServiceDetailView>>({
    status: 'loading',
  });
  const [confirm, setConfirm] = useState(false);
  const [branch, setBranch] = useState('');
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<{ ok: boolean; text: string } | null>(
    null,
  );

  async function load(refresh = false) {
    try {
      const { data } = await apiFetch<ApiSuccess<NfServiceDetailView>>(
        `/northflank/projects/${projectId}/services/${serviceId}?refresh=${refresh}`,
      );
      setDetail({ status: 'ok', data });
      setBranch((b) => b || data.branch || '');
    } catch (err) {
      setDetail({
        status: 'error',
        message: err instanceof ApiError ? err.message : 'Could not load.',
      });
    }
  }
  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId, serviceId]);
  const building =
    detail.status === 'ok' && detail.data.builds.some((b) => !b.concluded);
  usePolling(() => load(true), 10_000, building);

  async function startBuild() {
    setBusy(true);
    setNotice(null);
    try {
      await apiSend(
        'POST',
        `/northflank/projects/${projectId}/services/${serviceId}/build`,
        branch ? { branch } : {},
      );
      setNotice({ ok: true, text: 'Build started on Northflank.' });
      await load(true);
    } catch (err) {
      setNotice({
        ok: false,
        text:
          err instanceof ApiError ? err.message : 'Could not start the build.',
      });
    } finally {
      setBusy(false);
      setConfirm(false);
    }
  }

  if (detail.status === 'loading' || detail.status === 'idle') {
    return (
      <div className="border-t p-3">
        <Loader2
          className="size-4 animate-spin text-muted-foreground"
          aria-label="Loading"
        />
      </div>
    );
  }
  if (detail.status !== 'ok') {
    return (
      <p className="border-t p-3 text-sm text-destructive">
        {detail.status === 'error' ? detail.message : 'Could not load.'}
      </p>
    );
  }
  const d = detail.data;
  return (
    <div className="grid gap-3 border-t bg-muted/20 p-3">
      {notice && (
        <Alert variant={notice.ok ? 'default' : 'destructive'} role="status">
          <AlertDescription>{notice.text}</AlertDescription>
        </Alert>
      )}
      <p className="text-xs text-muted-foreground">
        {d.repoUrl ? `${d.repoUrl.replace('https://github.com/', '')} · ` : ''}
        {d.branch ? `branch ${d.branch}` : 'no git source'}
      </p>
      {d.canBuild ? (
        <div>
          <Button
            size="sm"
            onClick={() => setConfirm(true)}
            disabled={busy || building}
          >
            {busy || building ? (
              <Loader2 className="animate-spin" />
            ) : (
              <Hammer />
            )}
            {building ? 'Building…' : 'Start build'}
          </Button>
        </div>
      ) : (
        <p className="text-xs text-muted-foreground">
          This service runs an image; it has no builds.
        </p>
      )}
      {d.builds.length > 0 && (
        <ul className="divide-y rounded-lg border bg-background text-xs">
          {d.builds.map((b) => (
            <li key={b.id} className="flex flex-wrap items-center gap-3 p-2">
              <NfStatusBadge
                status={b.status ?? (b.success ? 'SUCCESS' : null)}
              />
              <span className="font-mono">{b.sha?.slice(0, 7) ?? '—'}</span>
              <span className="min-w-0 flex-1 truncate">
                {b.message ?? b.branch ?? ''}
              </span>
              <span className="text-muted-foreground">
                {formatRelative(b.createdAt)}
              </span>
            </li>
          ))}
        </ul>
      )}

      <AlertDialog open={confirm} onOpenChange={setConfirm}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Start a build of {d.name}?</AlertDialogTitle>
            <AlertDialogDescription>
              Northflank builds the latest commit of the branch. If the service
              deploys automatically, the new version replaces the running one.
              Note: pushing to GitHub may already trigger a build, so this could
              create a duplicate.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div className="grid gap-2">
            <Label htmlFor="nf-branch">Branch</Label>
            <Input
              id="nf-branch"
              value={branch}
              onChange={(e) => setBranch(e.target.value.trim())}
              spellCheck={false}
            />
          </div>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              disabled={busy || !branch}
              onClick={() => void startBuild()}
            >
              {busy && <Loader2 className="animate-spin" />}
              Start build
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

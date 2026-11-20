'use client';

import {
  RUNTIME_LABELS,
  type ApiSuccess,
  type ProjectView,
} from '@stackdock/shared';
import { Boxes, GitBranch, Plus, RefreshCw, Search } from 'lucide-react';
import Link from 'next/link';
import { useMemo, useState } from 'react';
import { EmptyState } from '@/components/layout/empty-state';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { LinkButton } from '@/components/ui/link-button';
import { useApi } from '@/lib/use-api';
import { cn } from '@/lib/utils';
import { ProjectStatusBadge } from './project-status-badge';

export function ProjectsList() {
  const [tab, setTab] = useState<'active' | 'archived'>('active');
  const [query, setQuery] = useState('');
  const { state, retry } = useApi<ApiSuccess<ProjectView[]>>(
    `/projects?archived=${tab === 'archived'}`,
  );

  const projects = useMemo(() => {
    if (state.status !== 'success') return [];
    const q = query.trim().toLowerCase();
    return state.data.data.filter(
      (p) =>
        !q ||
        p.name.toLowerCase().includes(q) ||
        p.slug.includes(q) ||
        p.repoUrl.toLowerCase().includes(q),
    );
  }, [state, query]);

  return (
    <div className="grid gap-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div
          role="tablist"
          aria-label="Project filter"
          className="inline-flex rounded-lg border p-0.5"
        >
          {(['active', 'archived'] as const).map((t) => (
            <button
              key={t}
              role="tab"
              aria-selected={tab === t}
              onClick={() => setTab(t)}
              className={cn(
                'rounded-md px-3 py-1 text-sm capitalize outline-none focus-visible:ring-3 focus-visible:ring-ring/50',
                tab === t
                  ? 'bg-muted font-medium'
                  : 'text-muted-foreground hover:text-foreground',
              )}
            >
              {t}
            </button>
          ))}
        </div>
        <div className="relative sm:w-64">
          <Search
            className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground"
            aria-hidden
          />
          <Input
            aria-label="Search projects"
            placeholder="Search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className="pl-8"
          />
        </div>
      </div>

      {state.status === 'loading' && (
        <p className="text-sm text-muted-foreground">Loading projects…</p>
      )}

      {state.status === 'error' && (
        <div className="flex items-center gap-3 text-sm">
          <span className="text-muted-foreground">{state.error.message}</span>
          <Button variant="outline" size="sm" onClick={retry}>
            <RefreshCw /> Retry
          </Button>
        </div>
      )}

      {state.status === 'success' && state.data.data.length === 0 && (
        <EmptyState
          icon={Boxes}
          title={tab === 'active' ? 'No projects yet' : 'No archived projects'}
          description={
            tab === 'active'
              ? 'Register a public GitHub repository to run it with StackDock.'
              : 'Archived projects appear here and can be restored.'
          }
          action={
            tab === 'active' && (
              <LinkButton href="/projects/new">
                <Plus /> New project
              </LinkButton>
            )
          }
        />
      )}

      {state.status === 'success' &&
        state.data.data.length > 0 &&
        projects.length === 0 && (
          <p className="text-sm text-muted-foreground">
            No projects match “{query}”.
          </p>
        )}

      {projects.length > 0 && (
        <ul className="divide-y rounded-xl border">
          {projects.map((p) => (
            <li key={p.id}>
              <Link
                href={`/projects/view?slug=${p.slug}`}
                className="flex flex-col gap-2 p-4 outline-none hover:bg-muted/40 focus-visible:ring-3 focus-visible:ring-ring/50 sm:flex-row sm:items-center sm:gap-4"
              >
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="truncate font-medium">{p.name}</span>
                    <Badge variant="outline" className="font-mono">
                      {p.slug}
                    </Badge>
                  </div>
                  <p className="mt-0.5 truncate text-xs text-muted-foreground">
                    {p.repoUrl.replace('https://github.com/', '')}
                    <GitBranch className="mx-1 inline size-3" aria-hidden />
                    {p.branch}
                  </p>
                </div>
                <span className="text-xs text-muted-foreground">
                  {RUNTIME_LABELS[p.runtime]}
                </span>
                <ProjectStatusBadge
                  status={p.status}
                  archived={Boolean(p.archivedAt)}
                />
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

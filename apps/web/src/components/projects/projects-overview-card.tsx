'use client';

import type { ApiSuccess, ProjectView } from '@stackdock/shared';
import { Plus } from 'lucide-react';
import Link from 'next/link';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { LinkButton } from '@/components/ui/link-button';
import { useApi } from '@/lib/use-api';
import { ProjectStatusBadge } from './project-status-badge';

export function ProjectsOverviewCard() {
  const { state } = useApi<ApiSuccess<ProjectView[]>>('/projects');
  const projects = state.status === 'success' ? state.data.data : [];
  const running = projects.filter((p) => p.status === 'RUNNING').length;

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between gap-3">
          <CardTitle>Projects</CardTitle>
          <LinkButton size="sm" variant="outline" href="/projects/new">
            <Plus /> Add project
          </LinkButton>
        </div>
        <CardDescription>
          {state.status === 'error'
            ? state.error.message
            : state.status === 'loading'
              ? 'Loading…'
              : `${projects.length} registered · ${running} running`}
        </CardDescription>
      </CardHeader>
      {projects.length > 0 && (
        <CardContent>
          <ul className="divide-y rounded-lg border text-sm">
            {projects.slice(0, 8).map((p) => (
              <li key={p.id}>
                <Link
                  href={`/projects/view?slug=${p.slug}`}
                  className="flex items-center gap-3 p-3 hover:bg-muted/40"
                >
                  <span className="min-w-0 flex-1 truncate">{p.name}</span>
                  <span className="font-mono text-xs text-muted-foreground">
                    {p.slug}
                  </span>
                  <ProjectStatusBadge status={p.status} />
                </Link>
              </li>
            ))}
          </ul>
        </CardContent>
      )}
    </Card>
  );
}

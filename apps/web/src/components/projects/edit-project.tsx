'use client';

import type { ApiSuccess, ProjectView } from '@stackdock/shared';
import { Loader2 } from 'lucide-react';
import { useSearchParams } from 'next/navigation';
import { PageHeader } from '@/components/layout/page-header';
import { useApi } from '@/lib/use-api';
import { ProjectForm } from './project-form';

export function EditProject() {
  const slug = useSearchParams().get('slug') ?? '';
  const { state } = useApi<ApiSuccess<ProjectView>>(
    `/projects/${encodeURIComponent(slug)}`,
  );
  if (state.status === 'loading')
    return (
      <Loader2
        className="size-5 animate-spin text-muted-foreground"
        aria-label="Loading"
      />
    );
  if (state.status === 'error')
    return (
      <p className="text-sm text-muted-foreground">{state.error.message}</p>
    );
  return (
    <>
      <PageHeader title={`Edit ${state.data.data.name}`} />
      <ProjectForm project={state.data.data} />
    </>
  );
}

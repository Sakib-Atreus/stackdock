import type { ProjectStatus } from '@stackdock/shared';
import { Badge } from '@/components/ui/badge';

const LABEL: Record<ProjectStatus, string> = {
  NOT_DEPLOYED: 'Not deployed',
  QUEUED: 'Queued',
  BUILDING: 'Building',
  STARTING: 'Starting',
  RUNNING: 'Running',
  CRASHED: 'Crashed',
  STOPPED: 'Stopped',
  FAILED: 'Failed',
};

export function ProjectStatusBadge({
  status,
  archived = false,
}: {
  status: ProjectStatus;
  archived?: boolean;
}) {
  if (archived) return <Badge variant="outline">Archived</Badge>;
  const variant =
    status === 'RUNNING'
      ? 'secondary'
      : status === 'CRASHED' || status === 'FAILED'
        ? 'destructive'
        : 'outline';
  return <Badge variant={variant}>{LABEL[status]}</Badge>;
}

import type { DeploymentStatus } from '@stackdock/shared';
import { Loader2 } from 'lucide-react';
import { Badge } from '@/components/ui/badge';

const LABEL: Record<DeploymentStatus, string> = {
  QUEUED: 'Queued',
  CLONING: 'Cloning',
  INSTALLING: 'Installing',
  BUILDING: 'Building',
  STARTING: 'Starting',
  LIVE: 'Live',
  SUPERSEDED: 'Replaced',
  STOPPED: 'Stopped',
  FAILED: 'Failed',
  CANCELLED: 'Cancelled',
};

const ACTIVE = new Set<DeploymentStatus>([
  'QUEUED',
  'CLONING',
  'INSTALLING',
  'BUILDING',
  'STARTING',
]);

export function DeploymentStatusBadge({
  status,
}: {
  status: DeploymentStatus;
}) {
  const variant =
    status === 'LIVE'
      ? 'secondary'
      : status === 'FAILED'
        ? 'destructive'
        : 'outline';
  return (
    <Badge variant={variant}>
      {ACTIVE.has(status) && <Loader2 className="animate-spin" aria-hidden />}
      {LABEL[status]}
    </Badge>
  );
}

export const isActiveDeployment = (s: DeploymentStatus) => ACTIVE.has(s);

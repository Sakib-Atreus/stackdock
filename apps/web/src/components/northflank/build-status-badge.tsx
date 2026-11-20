import { NF_BUILD_ACTIVE } from '@stackdock/shared';
import { Loader2 } from 'lucide-react';
import { Badge } from '@/components/ui/badge';

/** Shows a Northflank build/deployment status string as returned by the API. */
export function NfStatusBadge({ status }: { status: string | null }) {
  if (!status) return <Badge variant="outline">—</Badge>;
  const failed = [
    'FAILURE',
    'FAILED',
    'CRASHED',
    'ABORTED',
    'SUBMISSION_FAILURE',
    'UNSCHEDULABLE',
  ].includes(status);
  const ok = ['SUCCESS', 'COMPLETED'].includes(status);
  const active = NF_BUILD_ACTIVE.includes(status);
  return (
    <Badge variant={failed ? 'destructive' : ok ? 'secondary' : 'outline'}>
      {active && <Loader2 className="animate-spin" aria-hidden />}
      {status.toLowerCase().replace(/_/g, ' ')}
    </Badge>
  );
}

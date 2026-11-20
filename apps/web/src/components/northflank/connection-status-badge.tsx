import type { ProviderConnectionView } from '@stackdock/shared';
import { Badge } from '@/components/ui/badge';

export function ConnectionStatusBadge({
  connection,
}: {
  connection: ProviderConnectionView | null;
}) {
  if (!connection?.connected)
    return <Badge variant="outline">Not connected</Badge>;
  if (connection.status === 'ERROR')
    return <Badge variant="destructive">Error</Badge>;
  return <Badge variant="secondary">Connected</Badge>;
}

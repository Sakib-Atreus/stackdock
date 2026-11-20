'use client';

import Link from 'next/link';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { formatRelative } from '@/lib/format';
import { ConnectionStatusBadge } from './connection-status-badge';
import { useNorthflankConnection } from './use-northflank-connection';

/** Compact status for Overview / Northflank pages. */
export function NorthflankStatusCard() {
  const { state, connection } = useNorthflankConnection();
  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between gap-3">
          <CardTitle>Northflank</CardTitle>
          {state.status === 'success' && (
            <ConnectionStatusBadge connection={connection} />
          )}
        </div>
        <CardDescription>
          {state.status === 'error'
            ? state.error.message
            : connection?.connected
              ? `Team ${connection.account?.entityId ?? '—'} · last tested ${formatRelative(connection.lastTestedAt)}`
              : 'Not connected yet.'}
        </CardDescription>
      </CardHeader>
      <CardContent>
        <Link
          href="/settings"
          className="text-sm underline underline-offset-4 outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
        >
          {connection?.connected ? 'Manage connection' : 'Connect in Settings'}
        </Link>
      </CardContent>
    </Card>
  );
}

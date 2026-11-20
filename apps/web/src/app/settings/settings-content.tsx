'use client';

import { useState } from 'react';
import { NorthflankConnectionCard } from '@/components/northflank/northflank-connection-card';
import { ChangePasswordCard } from '@/components/settings/change-password-card';
import { SessionsCard } from '@/components/settings/sessions-card';

export function SettingsContent() {
  const [refreshKey, setRefreshKey] = useState(0);
  return (
    <div className="grid gap-6">
      <NorthflankConnectionCard />
      <ChangePasswordCard onChanged={() => setRefreshKey((n) => n + 1)} />
      <SessionsCard refreshKey={refreshKey} />
      <p className="text-xs text-muted-foreground">
        Forgot your password? Run{' '}
        <code className="font-mono">pnpm admin:reset-password</code> on the
        server.
      </p>
    </div>
  );
}

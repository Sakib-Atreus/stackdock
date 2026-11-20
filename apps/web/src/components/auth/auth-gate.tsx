'use client';

import { Loader2, RefreshCw } from 'lucide-react';
import { usePathname } from 'next/navigation';
import type { ReactNode } from 'react';
import { Button } from '@/components/ui/button';
import { PUBLIC_PATHS, useAuth } from './auth-provider';

/** Renders protected UI only once a session is confirmed. */
export function AuthGate({
  children,
  publicContent,
}: {
  children: ReactNode;
  publicContent: ReactNode;
}) {
  const { state, reload } = useAuth();
  const pathname = usePathname();

  if (PUBLIC_PATHS.includes(pathname)) return publicContent;

  if (state.status === 'signed-in') return children;

  if (state.status === 'error') {
    return (
      <FullScreen>
        <p className="text-sm text-muted-foreground">
          Can&apos;t reach the StackDock server.
        </p>
        <Button variant="outline" size="sm" onClick={reload}>
          <RefreshCw /> Retry
        </Button>
      </FullScreen>
    );
  }

  return (
    <FullScreen>
      <Loader2
        className="size-5 animate-spin text-muted-foreground"
        aria-label="Loading"
      />
    </FullScreen>
  );
}

function FullScreen({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-3">
      {children}
    </div>
  );
}

'use client';

import type { ReactNode } from 'react';
import { AuthGate } from '@/components/auth/auth-gate';
import { AuthProvider } from '@/components/auth/auth-provider';
import { AppShell } from './app-shell';

export function RootShell({ children }: { children: ReactNode }) {
  return (
    <AuthProvider>
      <AuthGate publicContent={children}>
        <AppShell>{children}</AppShell>
      </AuthGate>
    </AuthProvider>
  );
}

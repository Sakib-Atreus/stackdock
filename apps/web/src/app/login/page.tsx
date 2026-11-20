import type { Metadata } from 'next';
import { Suspense } from 'react';
import { LoginForm } from '@/components/auth/login-form';

export const metadata: Metadata = { title: 'Sign in · StackDock' };

export default function LoginPage() {
  // useSearchParams() needs a Suspense boundary in a static export.
  return (
    <Suspense>
      <LoginForm />
    </Suspense>
  );
}

'use client';

import {
  loginSchema,
  type ApiSuccess,
  type SessionInfo,
} from '@stackdock/shared';
import { Loader2 } from 'lucide-react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useState, type FormEvent } from 'react';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { ApiError, apiSend } from '@/lib/api';
import { safeNextPath } from '@/lib/safe-next';
import { Logo } from '@/components/layout/logo';
import { useAuth } from './auth-provider';

export function LoginForm() {
  const { state, signedIn } = useAuth();
  const router = useRouter();
  const next = safeNextPath(useSearchParams().get('next'));
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  // Already signed in → leave the login page.
  useEffect(() => {
    if (state.status === 'signed-in') router.replace(next);
  }, [state.status, next, router]);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    const form = new FormData(event.currentTarget);
    const parsed = loginSchema.safeParse({
      email: form.get('email'),
      password: form.get('password'),
    });
    if (!parsed.success) {
      setError('Enter your email and password.');
      return;
    }

    setSubmitting(true);
    try {
      const { data } = await apiSend<ApiSuccess<SessionInfo>>(
        'POST',
        '/auth/login',
        parsed.data,
      );
      if (data.user) {
        signedIn(data.user);
        router.replace(next);
      }
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Something went wrong.');
      setSubmitting(false);
    }
  }

  return (
    <main className="flex min-h-screen items-center justify-center p-4">
      <Card className="w-full max-w-sm">
        <CardHeader>
          <div className="mb-2 flex items-center gap-2">
            <Logo size={28} />
            <span className="font-semibold tracking-tight">StackDock</span>
          </div>
          <CardTitle>
            <h1>Sign in</h1>
          </CardTitle>
          <CardDescription>
            Private dashboard. Admin access only.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={onSubmit} className="grid gap-4" noValidate>
            {error && (
              <Alert variant="destructive" role="alert">
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            )}
            <div className="grid gap-2">
              <Label htmlFor="email">Email</Label>
              <Input
                id="email"
                name="email"
                type="email"
                autoComplete="username"
                required
                autoFocus
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="password">Password</Label>
              <Input
                id="password"
                name="password"
                type="password"
                autoComplete="current-password"
                required
              />
            </div>
            <Button type="submit" disabled={submitting} className="w-full">
              {submitting && <Loader2 className="animate-spin" />}
              {submitting ? 'Signing in…' : 'Sign in'}
            </Button>
          </form>
        </CardContent>
      </Card>
    </main>
  );
}

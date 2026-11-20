'use client';

import { changePasswordSchema, PASSWORD_MIN_LENGTH } from '@stackdock/shared';
import { CheckCircle2, Loader2 } from 'lucide-react';
import { useState, type FormEvent } from 'react';
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

type Status =
  | { kind: 'idle' }
  | { kind: 'saving' }
  | { kind: 'done' }
  | { kind: 'error'; message: string };

export function ChangePasswordCard({ onChanged }: { onChanged?: () => void }) {
  const [status, setStatus] = useState<Status>({ kind: 'idle' });

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formEl = event.currentTarget;
    const form = new FormData(formEl);
    if (form.get('newPassword') !== form.get('confirmPassword')) {
      setStatus({ kind: 'error', message: 'New passwords do not match.' });
      return;
    }
    const parsed = changePasswordSchema.safeParse({
      currentPassword: form.get('currentPassword'),
      newPassword: form.get('newPassword'),
    });
    if (!parsed.success) {
      setStatus({
        kind: 'error',
        message: parsed.error.issues[0]?.message ?? 'Invalid input.',
      });
      return;
    }

    setStatus({ kind: 'saving' });
    try {
      await apiSend('POST', '/auth/password', parsed.data);
      formEl.reset();
      setStatus({ kind: 'done' });
      onChanged?.();
    } catch (err) {
      setStatus({
        kind: 'error',
        message:
          err instanceof ApiError ? err.message : 'Something went wrong.',
      });
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Change password</CardTitle>
        <CardDescription>
          At least {PASSWORD_MIN_LENGTH} characters. Other sessions will be
          signed out.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={onSubmit} className="grid max-w-sm gap-4" noValidate>
          {status.kind === 'error' && (
            <Alert variant="destructive" role="alert">
              <AlertDescription>{status.message}</AlertDescription>
            </Alert>
          )}
          {status.kind === 'done' && (
            <Alert role="status">
              <CheckCircle2 />
              <AlertDescription>Password changed.</AlertDescription>
            </Alert>
          )}
          <Field
            id="currentPassword"
            label="Current password"
            auto="current-password"
          />
          <Field id="newPassword" label="New password" auto="new-password" />
          <Field
            id="confirmPassword"
            label="Repeat new password"
            auto="new-password"
          />
          <div>
            <Button type="submit" disabled={status.kind === 'saving'}>
              {status.kind === 'saving' && <Loader2 className="animate-spin" />}
              Change password
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}

function Field({
  id,
  label,
  auto,
}: {
  id: string;
  label: string;
  auto: string;
}) {
  return (
    <div className="grid gap-2">
      <Label htmlFor={id}>{label}</Label>
      <Input id={id} name={id} type="password" autoComplete={auto} required />
    </div>
  );
}

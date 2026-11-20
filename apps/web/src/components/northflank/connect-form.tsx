'use client';

import {
  connectNorthflankSchema,
  type ApiSuccess,
  type ProviderConnectionView,
} from '@stackdock/shared';
import { Loader2 } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { ApiError, apiSend } from '@/lib/api';

export function ConnectForm({
  replacing,
  onConnected,
  onCancel,
}: {
  replacing: boolean;
  onConnected: (view: ProviderConnectionView) => void;
  onCancel?: () => void;
}) {
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    const formEl = event.currentTarget;
    const parsed = connectNorthflankSchema.safeParse({
      token: new FormData(formEl).get('token'),
    });
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? 'Invalid token.');
      return;
    }
    setSaving(true);
    try {
      const { data } = await apiSend<ApiSuccess<ProviderConnectionView>>(
        'POST',
        '/providers/northflank/connect',
        parsed.data,
      );
      formEl.reset(); // don't keep the token in the DOM
      onConnected(data);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Something went wrong.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="grid max-w-md gap-3" noValidate>
      {error && (
        <Alert variant="destructive" role="alert">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}
      <div className="grid gap-2">
        <Label htmlFor="nf-token">
          {replacing ? 'New Northflank API token' : 'Northflank API token'}
        </Label>
        <Input
          id="nf-token"
          name="token"
          type="password"
          autoComplete="off"
          spellCheck={false}
          placeholder="Paste token"
          required
        />
        <p className="text-xs text-muted-foreground">
          StackDock checks the token with Northflank, then stores it encrypted.
          It is never shown again.
        </p>
      </div>
      <div className="flex gap-2">
        <Button type="submit" disabled={saving}>
          {saving && <Loader2 className="animate-spin" />}
          {saving ? 'Verifying…' : replacing ? 'Replace token' : 'Connect'}
        </Button>
        {onCancel && (
          <Button type="button" variant="ghost" onClick={onCancel}>
            Cancel
          </Button>
        )}
      </div>
    </form>
  );
}

'use client';

import {
  envKeySchema,
  setEnvVarSchema,
  type ApiSuccess,
  type EnvVarView,
} from '@stackdock/shared';
import { KeyRound, Loader2, Plus, RefreshCw, Trash2 } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { Alert, AlertDescription } from '@/components/ui/alert';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { ApiError, apiSend } from '@/lib/api';
import { formatRelative } from '@/lib/format';
import { useApi } from '@/lib/use-api';
import { FormField } from './form-field';

type Pending =
  | { kind: 'replace'; key: string; value: string }
  | { kind: 'delete'; key: string }
  | null;

export function EnvVarsCard({
  slug,
  readOnly,
  onChanged,
}: {
  slug: string;
  readOnly: boolean;
  onChanged?: () => void;
}) {
  const { state, retry } = useApi<ApiSuccess<EnvVarView[]>>(
    `/projects/${slug}/env`,
  );
  const [editing, setEditing] = useState<{
    key: string;
    isNew: boolean;
  } | null>(null);
  const [errors, setErrors] = useState<{ key?: string; value?: string }>({});
  const [pending, setPending] = useState<Pending>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<{ ok: boolean; text: string } | null>(
    null,
  );

  const keys =
    state.status === 'success' ? state.data.data.map((v) => v.key) : [];

  async function save(key: string, value: string) {
    setBusy(true);
    try {
      const { data } = await apiSend<ApiSuccess<{ replaced: boolean }>>(
        'PUT',
        `/projects/${slug}/env/${encodeURIComponent(key)}`,
        { value },
      );
      setNotice({
        ok: true,
        text: `${key} ${data.replaced ? 'replaced' : 'added'}.`,
      });
      setEditing(null);
      retry();
      onChanged?.();
    } catch (err) {
      setNotice({
        ok: false,
        text: err instanceof ApiError ? err.message : 'Something went wrong.',
      });
    } finally {
      setBusy(false);
      setPending(null);
    }
  }

  async function remove(key: string) {
    setBusy(true);
    try {
      await apiSend(
        'DELETE',
        `/projects/${slug}/env/${encodeURIComponent(key)}`,
      );
      setNotice({ ok: true, text: `${key} deleted.` });
      retry();
      onChanged?.();
    } catch (err) {
      setNotice({
        ok: false,
        text: err instanceof ApiError ? err.message : 'Something went wrong.',
      });
    } finally {
      setBusy(false);
      setPending(null);
    }
  }

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formEl = event.currentTarget;
    const form = new FormData(formEl);
    const key = String(form.get('envKey') ?? '').trim();
    const value = String(form.get('envValue') ?? '');
    const next: typeof errors = {};
    const k = envKeySchema.safeParse(key);
    if (!k.success) next.key = k.error.issues[0]?.message;
    const v = setEnvVarSchema.safeParse({ value });
    if (!v.success) next.value = v.error.issues[0]?.message;
    setErrors(next);
    if (next.key || next.value) return;

    formEl.reset(); // don't keep the secret in the DOM
    if (keys.includes(key)) setPending({ kind: 'replace', key, value });
    else void save(key, value);
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between gap-3">
          <CardTitle>
            <h2>Environment variables</h2>
          </CardTitle>
          {!readOnly && !editing && (
            <Button
              size="sm"
              variant="outline"
              onClick={() => {
                setErrors({});
                setEditing({ key: '', isNew: true });
              }}
            >
              <Plus /> Add variable
            </Button>
          )}
        </div>
        <CardDescription>
          Values are encrypted and never shown again after saving. StackDock
          sets PORT and BASE_PATH itself. Changes apply on the next deploy.
        </CardDescription>
      </CardHeader>
      <CardContent className="grid gap-4" aria-live="polite">
        {notice && (
          <Alert variant={notice.ok ? 'default' : 'destructive'} role="status">
            <AlertDescription>{notice.text}</AlertDescription>
          </Alert>
        )}

        {editing && (
          <form
            onSubmit={onSubmit}
            noValidate
            className="grid gap-3 rounded-lg border p-3"
          >
            <FormField id="envKey" label="Name" error={errors.key}>
              <Input
                id="envKey"
                name="envKey"
                defaultValue={editing.key}
                readOnly={!editing.isNew}
                placeholder="DATABASE_URL"
                autoComplete="off"
                spellCheck={false}
                className="font-mono"
                aria-invalid={errors.key ? true : undefined}
                autoFocus={editing.isNew}
              />
            </FormField>
            <FormField
              id="envValue"
              label={editing.isNew ? 'Value' : 'New value'}
              error={errors.value}
              hint="Multi-line values are fine. Max 32 KB."
            >
              <Textarea
                id="envValue"
                name="envValue"
                rows={3}
                autoComplete="off"
                spellCheck={false}
                className="font-mono"
                aria-invalid={errors.value ? true : undefined}
                autoFocus={!editing.isNew}
              />
            </FormField>
            <div className="flex gap-2">
              <Button type="submit" size="sm" disabled={busy}>
                {busy && <Loader2 className="animate-spin" />}
                Save
              </Button>
              <Button
                type="button"
                size="sm"
                variant="ghost"
                onClick={() => setEditing(null)}
              >
                Cancel
              </Button>
            </div>
          </form>
        )}

        {state.status === 'loading' && (
          <Loader2
            className="size-4 animate-spin text-muted-foreground"
            aria-label="Loading"
          />
        )}
        {state.status === 'error' && (
          <div className="flex items-center gap-3 text-sm">
            <span className="text-muted-foreground">{state.error.message}</span>
            <Button variant="outline" size="sm" onClick={retry}>
              <RefreshCw /> Retry
            </Button>
          </div>
        )}
        {state.status === 'success' &&
          state.data.data.length === 0 &&
          !editing && (
            <p className="flex items-center gap-2 text-sm text-muted-foreground">
              <KeyRound className="size-4" aria-hidden /> No variables yet.
            </p>
          )}
        {state.status === 'success' && state.data.data.length > 0 && (
          <ul className="divide-y rounded-lg border text-sm">
            {state.data.data.map((v) => (
              <li key={v.key} className="flex flex-wrap items-center gap-3 p-3">
                <span className="min-w-0 flex-1 truncate font-mono">
                  {v.key}
                </span>
                <span
                  className="font-mono text-muted-foreground"
                  aria-label="Hidden value"
                >
                  ••••••••
                </span>
                <span className="text-xs text-muted-foreground">
                  updated {formatRelative(v.updatedAt)}
                </span>
                {!readOnly && (
                  <span className="flex gap-1">
                    <Button
                      size="xs"
                      variant="outline"
                      onClick={() => {
                        setErrors({});
                        setEditing({ key: v.key, isNew: false });
                      }}
                    >
                      Replace
                    </Button>
                    <Button
                      size="icon-xs"
                      variant="ghost"
                      aria-label={`Delete ${v.key}`}
                      onClick={() => setPending({ kind: 'delete', key: v.key })}
                    >
                      <Trash2 />
                    </Button>
                  </span>
                )}
              </li>
            ))}
          </ul>
        )}
      </CardContent>

      <AlertDialog
        open={pending !== null}
        onOpenChange={(open) => !open && setPending(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {pending?.kind === 'delete'
                ? `Delete ${pending.key}?`
                : `Replace ${pending?.key}?`}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {pending?.kind === 'delete'
                ? 'The variable is removed from this project. The running app keeps its current value until the next deploy.'
                : 'The saved value will be overwritten. The old value cannot be recovered.'}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              variant={pending?.kind === 'delete' ? 'destructive' : 'default'}
              disabled={busy}
              onClick={() => {
                if (pending?.kind === 'delete') void remove(pending.key);
                else if (pending?.kind === 'replace')
                  void save(pending.key, pending.value);
              }}
            >
              {busy && <Loader2 className="animate-spin" />}
              {pending?.kind === 'delete' ? 'Delete' : 'Replace'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  );
}

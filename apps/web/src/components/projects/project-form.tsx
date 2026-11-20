'use client';

import {
  createProjectSchema,
  PROJECT_RUNTIMES,
  PROJECT_SLUG_MAX_LENGTH,
  RUNTIME_DEFAULTS,
  RUNTIME_LABELS,
  updateProjectSchema,
  type ApiSuccess,
  type ProjectRuntime,
  type ProjectView,
} from '@stackdock/shared';
import { Loader2 } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useState, type FormEvent } from 'react';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { ApiError, apiSend } from '@/lib/api';
import { FormField } from './form-field';
import { NativeSelect } from './native-select';

type Errors = Record<string, string>;

const FIELDS = [
  'slug',
  'name',
  'description',
  'repoUrl',
  'branch',
  'runtime',
  'rootDir',
  'installCommand',
  'buildCommand',
  'startCommand',
  'healthCheckPath',
] as const;

export function ProjectForm({ project }: { project?: ProjectView }) {
  const editing = Boolean(project);
  const router = useRouter();
  const [runtime, setRuntime] = useState<ProjectRuntime>(
    project?.runtime ?? 'AUTO',
  );
  const [errors, setErrors] = useState<Errors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const defaults = runtime === 'AUTO' ? null : RUNTIME_DEFAULTS[runtime];
  const placeholder = (cmd: 'install' | 'build' | 'start') =>
    defaults
      ? defaults[cmd]
        ? `Default: ${defaults[cmd]}`
        : 'None by default'
      : 'Default depends on the detected language';

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setFormError(null);
    const form = new FormData(event.currentTarget);
    const raw: Record<string, string> = {};
    for (const f of FIELDS) {
      const v = form.get(f);
      if (typeof v === 'string') raw[f] = v;
    }

    const parsed = editing
      ? updateProjectSchema.safeParse(raw)
      : createProjectSchema.safeParse(raw);
    if (!parsed.success) {
      const next: Errors = {};
      for (const issue of parsed.error.issues) {
        const key = String(issue.path[0] ?? '_');
        next[key] ??= issue.message;
      }
      setErrors(next);
      return;
    }
    setErrors({});
    setSaving(true);
    try {
      const { data } = editing
        ? await apiSend<ApiSuccess<ProjectView>>(
            'PATCH',
            `/projects/${project!.slug}`,
            parsed.data,
          )
        : await apiSend<ApiSuccess<ProjectView>>(
            'POST',
            '/projects',
            parsed.data,
          );
      router.push(`/projects/view?slug=${data.slug}`);
    } catch (err) {
      setSaving(false);
      if (err instanceof ApiError) {
        if (err.fields) {
          setErrors(
            Object.fromEntries(
              Object.entries(err.fields).map(([k, v]) => [k, v[0] ?? '']),
            ),
          );
        }
        if (err.code === 'SLUG_TAKEN')
          setErrors((e) => ({ ...e, slug: err.message }));
        else setFormError(err.message);
      } else {
        setFormError('Something went wrong.');
      }
    }
  }

  const field = (id: string) => ({
    id,
    name: id,
    'aria-invalid': errors[id] ? true : undefined,
    'aria-describedby': errors[id] ? `${id}-error` : undefined,
  });

  return (
    <form onSubmit={onSubmit} noValidate className="grid gap-6">
      {formError && (
        <Alert variant="destructive" role="alert">
          <AlertDescription>{formError}</AlertDescription>
        </Alert>
      )}

      <Card>
        <CardHeader>
          <CardTitle>
            <h2>Basics</h2>
          </CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-2">
          <FormField
            id="slug"
            label="Short name"
            error={errors.slug}
            hint={
              editing
                ? 'Permanent. It is part of the project URL.'
                : `1–${PROJECT_SLUG_MAX_LENGTH} chars: lowercase letters, digits, hyphens. Becomes the URL (e.g. shop--…code.run). Can't be changed later.`
            }
          >
            <Input
              {...field('slug')}
              defaultValue={project?.slug}
              disabled={editing}
              maxLength={PROJECT_SLUG_MAX_LENGTH}
              autoComplete="off"
              spellCheck={false}
              placeholder="shop"
              required
            />
          </FormField>
          <FormField id="name" label="Display name" error={errors.name}>
            <Input
              {...field('name')}
              defaultValue={project?.name}
              placeholder="Shop API"
              required
            />
          </FormField>
          <div className="sm:col-span-2">
            <FormField
              id="description"
              label="Description (optional)"
              error={errors.description}
            >
              <Textarea
                {...field('description')}
                defaultValue={project?.description ?? ''}
                rows={2}
              />
            </FormField>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>
            <h2>Source</h2>
          </CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-2">
          <div className="sm:col-span-2">
            <FormField
              id="repoUrl"
              label="Public GitHub repository"
              error={errors.repoUrl}
              hint="Only public repositories are supported."
            >
              <Input
                {...field('repoUrl')}
                defaultValue={project?.repoUrl}
                placeholder="https://github.com/you/your-repo"
                inputMode="url"
                spellCheck={false}
                required
              />
            </FormField>
          </div>
          <FormField id="branch" label="Branch" error={errors.branch}>
            <Input
              {...field('branch')}
              defaultValue={project?.branch ?? 'main'}
              spellCheck={false}
              required
            />
          </FormField>
          <FormField
            id="rootDir"
            label="Folder in repo"
            error={errors.rootDir}
            hint="Use . for the repository root, or e.g. apps/api for a monorepo."
          >
            <Input
              {...field('rootDir')}
              defaultValue={project?.rootDir ?? '.'}
              spellCheck={false}
            />
          </FormField>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>
            <h2>Build &amp; run</h2>
          </CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-2">
          <FormField
            id="runtime"
            label="Language"
            error={errors.runtime}
            hint="Auto-detect looks for package.json, requirements.txt, go.mod or composer.json."
          >
            <NativeSelect
              {...field('runtime')}
              value={runtime}
              onChange={(e) => setRuntime(e.target.value as ProjectRuntime)}
            >
              {PROJECT_RUNTIMES.map((r) => (
                <option key={r} value={r}>
                  {RUNTIME_LABELS[r]}
                </option>
              ))}
            </NativeSelect>
          </FormField>
          <FormField
            id="healthCheckPath"
            label="Health check path (optional)"
            error={errors.healthCheckPath}
            hint="StackDock waits for this path to answer before marking the project running."
          >
            <Input
              {...field('healthCheckPath')}
              defaultValue={project?.healthCheckPath ?? ''}
              placeholder="/health"
              spellCheck={false}
            />
          </FormField>
          {(['install', 'build', 'start'] as const).map((cmd) => (
            <div key={cmd} className="sm:col-span-2">
              <FormField
                id={`${cmd}Command`}
                label={`${cmd[0]!.toUpperCase()}${cmd.slice(1)} command (optional)`}
                error={errors[`${cmd}Command`]}
                hint={
                  cmd === 'start'
                    ? 'Your app must listen on the PORT environment variable.'
                    : undefined
                }
              >
                <Input
                  {...field(`${cmd}Command`)}
                  defaultValue={project?.[`${cmd}Command`] ?? ''}
                  placeholder={placeholder(cmd)}
                  spellCheck={false}
                  className="font-mono"
                />
              </FormField>
            </div>
          ))}
        </CardContent>
      </Card>

      <div className="flex gap-2">
        <Button type="submit" disabled={saving}>
          {saving && <Loader2 className="animate-spin" />}
          {editing ? 'Save changes' : 'Create project'}
        </Button>
        <Button type="button" variant="ghost" onClick={() => router.back()}>
          Cancel
        </Button>
      </div>
      <p className="text-xs text-muted-foreground">
        Saving only records the project in StackDock. Nothing is built or
        deployed until you deploy it.
      </p>
    </form>
  );
}

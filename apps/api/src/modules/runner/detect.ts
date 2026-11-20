import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

export type Runtime = 'NODE' | 'PYTHON' | 'GO' | 'PHP';

export interface Plan {
  runtime: Runtime;
  install: string | null;
  build: string | null;
  start: string;
  /** Extra PATH entries (absolute) for every step, e.g. the Python venv. */
  pathPrefix: string[];
  notes: string[];
}

export class DetectionError extends Error {}

const has = (dir: string, file: string) => existsSync(path.join(dir, file));

export function detectRuntime(dir: string): Runtime | null {
  if (has(dir, 'package.json')) return 'NODE';
  if (has(dir, 'go.mod')) return 'GO';
  if (
    has(dir, 'requirements.txt') ||
    has(dir, 'pyproject.toml') ||
    has(dir, 'Pipfile')
  )
    return 'PYTHON';
  if (
    has(dir, 'composer.json') ||
    has(dir, 'index.php') ||
    has(dir, 'public/index.php') ||
    has(dir, 'web/index.php')
  )
    return 'PHP';
  return null;
}

interface Overrides {
  runtime: Runtime | 'AUTO';
  installCommand: string | null;
  buildCommand: string | null;
  startCommand: string | null;
}

/**
 * The `web:` command of a Heroku-style Procfile, if it can run here. Commands
 * that need Heroku-only tools (heroku-php-apache2, …) are ignored.
 */
export function procfileWebCommand(dir: string): string | null {
  if (!has(dir, 'Procfile')) return null;
  const line = readFileSync(path.join(dir, 'Procfile'), 'utf8')
    .split(/\r?\n/)
    .find((l) => /^web\s*:/.test(l));
  const command = line?.replace(/^web\s*:\s*/, '').trim();
  if (!command || /\bheroku-/.test(command) || command.length > 500)
    return null;
  return command;
}

/**
 * Decides what to run for a checkout.
 * Start command priority: project setting → Procfile `web:` → language default.
 */
export function planBuild(dir: string, o: Overrides): Plan {
  const runtime = o.runtime === 'AUTO' ? detectRuntime(dir) : o.runtime;
  if (!runtime) {
    throw new DetectionError(
      'Could not detect the language (no package.json, go.mod, requirements.txt, pyproject.toml or composer.json). Choose a language and set a start command.',
    );
  }
  const d = defaults(runtime, dir);
  // Go Procfiles name a binary produced by Heroku's buildpack, which doesn't
  // exist here (StackDock builds to ./.stackdock/bin/app), so they're ignored.
  const procfile = runtime === 'GO' ? null : procfileWebCommand(dir);
  const start = o.startCommand ?? procfile ?? d.start;
  const notes: string[] = [...d.notes];
  if (!o.startCommand && procfile)
    notes.push(`Start command from Procfile: ${procfile}`);
  if (!start) {
    throw new DetectionError(
      `No start command could be inferred for this ${runtime} project. Set one in the project settings.`,
    );
  }
  return {
    runtime,
    install: o.installCommand ?? d.install,
    build: o.buildCommand ?? d.build,
    start,
    pathPrefix: d.pathPrefix,
    notes,
  };
}

function defaults(runtime: Runtime, dir: string) {
  switch (runtime) {
    case 'NODE':
      return nodeDefaults(dir);
    case 'PYTHON':
      return pythonDefaults(dir);
    case 'GO':
      return {
        install:
          has(dir, 'go.sum') || has(dir, 'go.mod') ? 'go mod download' : null,
        build: 'go build -o ./.stackdock/bin/app .',
        start: './.stackdock/bin/app',
        pathPrefix: [],
        notes: [],
      };
    case 'PHP': {
      const docroot =
        has(dir, 'public/index.php') || has(dir, 'public')
          ? 'public'
          : has(dir, 'web/index.php')
            ? 'web'
            : '.';
      return {
        install: has(dir, 'composer.json')
          ? 'composer install --no-dev --no-interaction --prefer-dist --optimize-autoloader'
          : null,
        build: null,
        start: `php -S 127.0.0.1:$PORT -t ${docroot}`,
        pathPrefix: [],
        notes: [
          'PHP built-in server: fine for small apps, not for heavy traffic.',
        ],
      };
    }
  }
}

function nodeDefaults(dir: string) {
  let pkg: { scripts?: Record<string, string>; main?: string } = {};
  try {
    pkg = JSON.parse(
      readFileSync(path.join(dir, 'package.json'), 'utf8'),
    ) as typeof pkg;
  } catch {
    throw new DetectionError('package.json is not valid JSON.');
  }
  const pm = has(dir, 'pnpm-lock.yaml')
    ? 'pnpm'
    : has(dir, 'yarn.lock')
      ? 'yarn'
      : 'npm';
  const install =
    pm === 'pnpm'
      ? 'pnpm install --frozen-lockfile'
      : pm === 'yarn'
        ? 'yarn install --frozen-lockfile'
        : has(dir, 'package-lock.json')
          ? 'npm ci'
          : 'npm install';
  const scripts = pkg.scripts ?? {};
  const build = scripts.build ? `${pm} run build` : null;
  let start: string | null = null;
  if (scripts.start) start = `${pm} start`;
  else if (pkg.main && has(dir, pkg.main)) start = `node ${pkg.main}`;
  else if (has(dir, 'server.js')) start = 'node server.js';
  else if (has(dir, 'index.js')) start = 'node index.js';
  return {
    install,
    build,
    start,
    pathPrefix: [path.join(dir, 'node_modules', '.bin')],
    notes: [] as string[],
  };
}

function pythonDefaults(dir: string) {
  const venvBin = path.join(dir, '.venv', 'bin');
  const req = has(dir, 'requirements.txt')
    ? readFileSync(path.join(dir, 'requirements.txt'), 'utf8').toLowerCase()
    : '';
  const install = has(dir, 'requirements.txt')
    ? 'python3 -m venv .venv && pip install --no-cache-dir -r requirements.txt'
    : has(dir, 'pyproject.toml')
      ? 'python3 -m venv .venv && pip install --no-cache-dir .'
      : 'python3 -m venv .venv';

  const appFile = ['app.py', 'main.py', 'wsgi.py', 'server.py'].find((f) =>
    has(dir, f),
  );
  const module = appFile?.replace(/\.py$/, '');
  let start: string | null = null;
  if (/^gunicorn\b/m.test(req) && module) {
    start = `gunicorn --bind 127.0.0.1:$PORT ${module}:app`;
  } else if (/^uvicorn\b/m.test(req) && module) {
    start = `uvicorn ${module}:app --host 127.0.0.1 --port $PORT`;
  } else if (appFile) {
    start = `python ${appFile}`;
  }
  // Django needs collected static files (Heroku's buildpack does the same).
  const build = has(dir, 'manage.py')
    ? 'python manage.py collectstatic --noinput'
    : null;
  return {
    install,
    build,
    start,
    pathPrefix: [venvBin],
    notes: [] as string[],
  };
}

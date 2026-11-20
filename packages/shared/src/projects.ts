import { z } from 'zod';
import { projectSlugSchema } from './project-slug.js';

export const PROJECT_RUNTIMES = [
  'AUTO',
  'NODE',
  'PYTHON',
  'GO',
  'PHP',
] as const;
export type ProjectRuntime = (typeof PROJECT_RUNTIMES)[number];

export const RUNTIME_LABELS: Record<ProjectRuntime, string> = {
  AUTO: 'Auto-detect',
  NODE: 'Node.js',
  PYTHON: 'Python',
  GO: 'Go',
  PHP: 'PHP',
};

/** Shown as placeholders; the runner (Phase 5) uses these when a field is empty. */
export const RUNTIME_DEFAULTS: Record<
  Exclude<ProjectRuntime, 'AUTO'>,
  { install: string; build: string; start: string }
> = {
  NODE: {
    install: 'npm ci',
    build: 'npm run build --if-present',
    start: 'npm start',
  },
  PYTHON: {
    install: 'pip install -r requirements.txt',
    build: '',
    start: 'gunicorn app:app --bind 127.0.0.1:$PORT',
  },
  GO: {
    install: 'go mod download',
    build: 'go build -o ./bin/app .',
    start: './bin/app',
  },
  PHP: {
    install: 'composer install --no-dev',
    build: '',
    start: 'php -S 127.0.0.1:$PORT -t public',
  },
};

export const PROJECT_STATUSES = [
  'NOT_DEPLOYED',
  'QUEUED',
  'BUILDING',
  'STARTING',
  'RUNNING',
  'CRASHED',
  'STOPPED',
  'FAILED',
] as const;
export type ProjectStatus = (typeof PROJECT_STATUSES)[number];

const GITHUB_REPO =
  /^https:\/\/github\.com\/([A-Za-z0-9](?:[A-Za-z0-9-]{0,38}))\/([A-Za-z0-9._-]{1,100}?)(?:\.git)?\/?$/;

/** Public GitHub repo URL → normalised `https://github.com/owner/repo`. */
export const repoUrlSchema = z
  .string()
  .trim()
  .max(300)
  .regex(
    GITHUB_REPO,
    'Use a public GitHub URL like https://github.com/owner/repo',
  )
  .transform((url) => {
    const [, owner, repo] = GITHUB_REPO.exec(url)!;
    return `https://github.com/${owner}/${repo}`;
  });

export function parseGithubRepo(
  url: string,
): { owner: string; repo: string } | null {
  const m = GITHUB_REPO.exec(url);
  return m ? { owner: m[1]!, repo: m[2]! } : null;
}

/** Simplified git ref-name rules (git check-ref-format). */
export const branchSchema = z
  .string()
  .trim()
  .min(1, 'Branch is required')
  .max(200)
  .regex(/^[A-Za-z0-9._/-]+$/, 'Letters, digits, . _ / - only')
  .refine(
    (b) =>
      !b.startsWith('/') &&
      !b.endsWith('/') &&
      !b.startsWith('-') &&
      !b.includes('..') &&
      !b.includes('//') &&
      !b.endsWith('.lock') &&
      !b.endsWith('.'),
    'Not a valid branch name',
  );

/** Relative folder inside the repo, never escaping it. */
export const rootDirSchema = z
  .string()
  .trim()
  .max(200)
  .regex(/^[A-Za-z0-9._/-]*$/, 'Letters, digits, . _ / - only')
  .refine(
    (p) => !p.startsWith('/') && !p.split('/').includes('..'),
    'Must be a folder inside the repository',
  )
  .transform((p) => p.replace(/\/+$/, '').replace(/^\.\/?/, '') || '.');

const optionalCommand = z
  .string()
  .trim()
  .max(500, 'Max 500 characters')
  .refine((c) => !/[\r\n\0]/.test(c), 'Must be a single line')
  .transform((c) => (c === '' ? null : c))
  .nullable()
  .optional();

export const healthCheckPathSchema = z
  .string()
  .trim()
  .max(200)
  .regex(/^\/[A-Za-z0-9._~/?=&%-]*$/, 'Must start with / and contain no spaces')
  .transform((p) => (p === '' ? null : p))
  .nullable()
  .optional();

const projectFields = {
  name: z.string().trim().min(1, 'Name is required').max(80),
  description: z
    .string()
    .trim()
    .max(500)
    .transform((d) => (d === '' ? null : d))
    .nullable()
    .optional(),
  repoUrl: repoUrlSchema,
  branch: branchSchema,
  runtime: z.enum(PROJECT_RUNTIMES),
  rootDir: rootDirSchema,
  installCommand: optionalCommand,
  buildCommand: optionalCommand,
  startCommand: optionalCommand,
  healthCheckPath: z.preprocess(
    (v) => (v === '' ? null : v),
    healthCheckPathSchema,
  ),
};

export const createProjectSchema = z.object({
  slug: projectSlugSchema,
  ...projectFields,
  runtime: projectFields.runtime.default('AUTO'),
  rootDir: projectFields.rootDir.default('.'),
});
export type CreateProjectInput = z.infer<typeof createProjectSchema>;

/**
 * The slug is permanent (it is the project URL / Northflank port name).
 * No defaults here: a PATCH must only touch the fields it sends.
 */
export const updateProjectSchema = z
  .object(projectFields)
  .partial()
  .refine((v) => Object.keys(v).length > 0, 'Nothing to update');
export type UpdateProjectInput = z.infer<typeof updateProjectSchema>;

export interface ProjectView {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  repoUrl: string;
  branch: string;
  runtime: ProjectRuntime;
  rootDir: string;
  installCommand: string | null;
  buildCommand: string | null;
  startCommand: string | null;
  healthCheckPath: string | null;
  status: ProjectStatus;
  desiredState: 'RUNNING' | 'STOPPED';
  publicPort: number;
  lastCommitSha: string | null;
  lastDeployedAt: string | null;
  archivedAt: string | null;
  createdAt: string;
  updatedAt: string;
  envVarCount: number;
  /** Path-based URL (always available, D-15 fallback). */
  pathUrl: string;
  /** A public Northflank port was added for this project. */
  exposed: boolean;
  /** Its https://<slug>--….code.run URL once Northflank has applied it. */
  ownUrl: string | null;
}

// ── Environment variables ───────────────────────────────────────────────

export const ENV_VALUE_MAX_BYTES = 32 * 1024;

/** Names StackDock sets itself for every project. */
export const RESERVED_ENV_KEYS = [
  'PORT',
  'BASE_PATH',
  'HOST',
  'NODE_OPTIONS',
] as const;
export const RESERVED_ENV_PREFIX = 'STACKDOCK_';

export const envKeySchema = z
  .string()
  .min(1)
  .max(128, 'Max 128 characters')
  .regex(
    /^[A-Za-z_][A-Za-z0-9_]*$/,
    'Letters, digits and _ only; cannot start with a digit',
  )
  .refine(
    (k) => !(RESERVED_ENV_KEYS as readonly string[]).includes(k.toUpperCase()),
    'This name is set by StackDock',
  )
  .refine(
    (k) => !k.toUpperCase().startsWith(RESERVED_ENV_PREFIX),
    `Names starting with ${RESERVED_ENV_PREFIX} are reserved`,
  );

export const setEnvVarSchema = z.object({
  value: z
    .string()
    .refine((v) => !v.includes('\0'), 'Value cannot contain NUL characters')
    .refine(
      (v) => new TextEncoder().encode(v).length <= ENV_VALUE_MAX_BYTES,
      'Value is larger than 32 KB',
    ),
});
export type SetEnvVarInput = z.infer<typeof setEnvVarSchema>;

/** Never contains the value. */
export interface EnvVarView {
  key: string;
  createdAt: string;
  updatedAt: string;
}

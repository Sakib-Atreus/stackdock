import { z } from 'zod';

const base64Key32 = z
  .string()
  .refine(
    (value) => Buffer.from(value, 'base64').length === 32,
    'must be a base64-encoded 32-byte key (generate: openssl rand -base64 32)',
  );

export const envSchema = z.object({
  NODE_ENV: z
    .enum(['development', 'test', 'production'])
    .default('development'),
  /** Northflank sets PORT; locally we use API_PORT. */
  PORT: z.coerce.number().int().positive().optional(),
  API_PORT: z.coerce.number().int().positive().default(4000),
  DATABASE_URL: z
    .string()
    .regex(/^postgres(ql)?:\/\//, 'must be a postgres:// connection URL'),
  SESSION_SECRET: z.string().min(32, 'must be at least 32 characters'),
  CREDENTIAL_ENCRYPTION_KEY: base64Key32,
  /** Version number of CREDENTIAL_ENCRYPTION_KEY. Bump it when rotating. */
  CREDENTIAL_KEY_VERSION: z.coerce.number().int().min(1).max(1000).default(1),
  /**
   * The previous key (version = CREDENTIAL_KEY_VERSION - 1), kept only while
   * rotating so old ciphertexts can still be decrypted. See D-09.
   */
  CREDENTIAL_ENCRYPTION_KEY_PREVIOUS: base64Key32.optional(),
  /** Browser origin of the Next.js dev server. Only used for CORS in development. */
  WEB_URL: z.url().optional(),
  /** Directory of the static Next.js export. Defaults to ../web/out. */
  WEB_DIST_DIR: z.string().optional(),
  ROUTING_MODE: z.enum(['northflank-ports', 'path', 'host']).default('path'),

  // ── Runner (Phase 5) ───────────────────────────────────────────────
  /** Where project checkouts, caches and pid files live. Docker: /data. */
  DATA_DIR: z.string().default('.data'),
  /** Heap limit for Node projects (NODE_OPTIONS=--max-old-space-size). */
  PROJECT_MEMORY_MB: z.coerce.number().int().min(64).max(8192).default(256),
  MAX_RUNNING_PROJECTS: z.coerce.number().int().min(1).max(100).default(10),
  BUILD_STEP_TIMEOUT_SECONDS: z.coerce
    .number()
    .int()
    .min(10)
    .max(3600)
    .default(900),
  START_TIMEOUT_SECONDS: z.coerce.number().int().min(5).max(600).default(90),
  /** Max checkout size after clone, in MB. */
  MAX_REPO_SIZE_MB: z.coerce.number().int().min(1).max(10_000).default(500),
  /** Start projects that should be running when StackDock boots. */
  RUNNER_AUTOSTART: z
    .enum(['true', 'false'])
    .default('true')
    .transform((v) => v === 'true'),
  /** Tests only: allow file:// repositories. Refused in production. */
  RUNNER_ALLOW_LOCAL_REPOS: z
    .enum(['true', 'false'])
    .default('false')
    .transform((v) => v === 'true'),
  /**
   * Admin connection used ONLY to create/drop per-project databases (D-12).
   * Defaults to DATABASE_URL. On Northflank use the addon's *_ADMIN URI.
   */
  PROJECT_DB_ADMIN_URL: z
    .string()
    .regex(/^postgres(ql)?:\/\//, 'must be a postgres:// connection URL')
    .optional(),
  APP_VERSION: z.string().default('dev'),
  /**
   * Northflank API base URL. Only override for tests (mock server); it is
   * server configuration, never user input.
   */
  NORTHFLANK_API_URL: z.url().default('https://api.northflank.com/v1/'),
  /**
   * Injected by Northflank at runtime: StackDock's own project/service IDs and
   * the code.run hostnames of its public ports (comma-separated). Absent when
   * not running on Northflank (dev, laptop).
   */
  NF_PROJECT_ID: z
    .string()
    .regex(/^[a-z0-9][a-z0-9-]{0,62}$/)
    .optional(),
  NF_OBJECT_ID: z
    .string()
    .regex(/^[a-z0-9][a-z0-9-]{0,62}$/)
    .optional(),
  NF_HOSTS: z.string().max(10_000).optional(),
  /**
   * Number of reverse proxies in front of the app (Northflank: 1). Needed so
   * rate limiting sees the real client IP and cookies know HTTPS is used.
   */
  TRUST_PROXY: z.coerce.number().int().min(0).max(5).default(0),
  /** Absolute session lifetime. */
  SESSION_TTL_HOURS: z.coerce.number().int().min(1).max(720).default(168),
  /** Session expires after this long without activity. */
  SESSION_IDLE_HOURS: z.coerce.number().int().min(1).max(720).default(24),
});

export type Env = z.infer<typeof envSchema>;

function checkKeyRotation(env: Env, ctx: z.RefinementCtx): void {
  if (env.NODE_ENV === 'production' && env.RUNNER_ALLOW_LOCAL_REPOS) {
    ctx.addIssue({
      code: 'custom',
      path: ['RUNNER_ALLOW_LOCAL_REPOS'],
      message: 'must not be enabled in production',
    });
  }
  if (env.CREDENTIAL_ENCRYPTION_KEY_PREVIOUS) {
    if (env.CREDENTIAL_KEY_VERSION < 2) {
      ctx.addIssue({
        code: 'custom',
        path: ['CREDENTIAL_KEY_VERSION'],
        message: 'must be >= 2 when CREDENTIAL_ENCRYPTION_KEY_PREVIOUS is set',
      });
    }
    if (
      env.CREDENTIAL_ENCRYPTION_KEY_PREVIOUS === env.CREDENTIAL_ENCRYPTION_KEY
    ) {
      ctx.addIssue({
        code: 'custom',
        path: ['CREDENTIAL_ENCRYPTION_KEY_PREVIOUS'],
        message: 'must differ from CREDENTIAL_ENCRYPTION_KEY',
      });
    }
  }
}

/**
 * Validates environment variables. On failure, throws an error listing the
 * invalid variable NAMES and reasons only — values are never included.
 */
export function parseEnv(source: NodeJS.ProcessEnv): Env {
  const result = envSchema.superRefine(checkKeyRotation).safeParse(source);
  if (!result.success) {
    const problems = result.error.issues
      .map((issue) => `  - ${issue.path.join('.')}: ${issue.message}`)
      .join('\n');
    throw new Error(`Invalid environment configuration:\n${problems}`);
  }
  return result.data;
}

export const ENV = Symbol('ENV');

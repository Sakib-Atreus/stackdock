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
  APP_VERSION: z.string().default('dev'),
  /**
   * Northflank API base URL. Only override for tests (mock server); it is
   * server configuration, never user input.
   */
  NORTHFLANK_API_URL: z.url().default('https://api.northflank.com/v1/'),
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

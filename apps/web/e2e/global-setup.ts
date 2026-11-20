import { execFileSync } from 'node:child_process';
import path from 'node:path';
import pg from 'pg';
import { E2E_DATABASE_URL } from '../playwright.config';

export const ADMIN = {
  email: 'e2e-admin@example.com',
  password: 'e2e admin password 123',
};

/** Fresh test database with exactly one admin, created via the real CLI. */
export default async function globalSetup(): Promise<void> {
  const dbDir = path.resolve(import.meta.dirname, '../../../packages/db');
  execFileSync('pnpm', ['exec', 'prisma', 'migrate', 'deploy'], {
    cwd: dbDir,
    env: { ...process.env, DATABASE_URL: E2E_DATABASE_URL },
    stdio: 'pipe',
  });

  const client = new pg.Client({ connectionString: E2E_DATABASE_URL });
  await client.connect();
  await client.query(
    'TRUNCATE "Session", "AdminUser", "ActivityLog", "ProviderConnection", "ProjectEnvVar", "Project" RESTART IDENTITY CASCADE',
  );
  await client.end();

  execFileSync('node', ['../api/dist/cli/admin.js', 'create'], {
    cwd: path.resolve(import.meta.dirname, '..'),
    env: {
      ...process.env,
      DATABASE_URL: E2E_DATABASE_URL,
      SESSION_SECRET: 'e2e-session-secret-'.padEnd(40, 'x'),
      CREDENTIAL_ENCRYPTION_KEY: Buffer.alloc(32, 9).toString('base64'),
      ADMIN_EMAIL: ADMIN.email,
      ADMIN_INITIAL_PASSWORD: ADMIN.password,
    },
    stdio: 'pipe',
  });
}

import { execFileSync } from 'node:child_process';
import path from 'node:path';
import pg from 'pg';
import { FixtureRepo, nodeApp } from '../../api/test/support/fixture-repo';
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
    'TRUNCATE "Session", "AdminUser", "ActivityLog", "ProviderConnection", "ProjectEnvVar", "ProjectDatabase", "Deployment", "Project" RESTART IDENTITY CASCADE',
  );
  for (const { datname } of (
    await client.query(
      "SELECT datname FROM pg_database WHERE datname LIKE 'proj\\_%'",
    )
  ).rows) {
    await client.query(`DROP DATABASE IF EXISTS "${datname}" WITH (FORCE)`);
  }
  for (const { rolname } of (
    await client.query(
      "SELECT rolname FROM pg_roles WHERE rolname LIKE 'proj\\_%'",
    )
  ).rows) {
    await client.query(`DROP ROLE IF EXISTS "${rolname}"`);
  }

  // A deployable project backed by a local git repo (the UI only accepts
  // GitHub URLs, so it's inserted directly; RUNNER_ALLOW_LOCAL_REPOS=true).
  // (The server is already running here, so its data dir is left alone.)
  const repo = new FixtureRepo(nodeApp('e2e-v1'));
  await client.query(
    `INSERT INTO "Project" (id, slug, name, "repoUrl", branch, "publicPort", "updatedAt")
     VALUES ('e2eproject0000000001', 'webapp', 'Web App', $1, 'main', 10001, now())`,
    [repo.url],
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

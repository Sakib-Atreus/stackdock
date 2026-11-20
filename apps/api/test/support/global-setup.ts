import { execFileSync } from 'node:child_process';
import path from 'node:path';
import pg from 'pg';

export const TEST_DATABASE_URL =
  process.env.TEST_DATABASE_URL ??
  'postgresql://postgres:postgres@localhost:5433/stackdock_test';

/**
 * Integration tests use a real Postgres database (`stackdock_test`), separate
 * from the dev database. Requires `pnpm db:up`.
 */
export default async function setup(): Promise<void> {
  const url = new URL(TEST_DATABASE_URL);
  const dbName = url.pathname.slice(1);
  const adminUrl = new URL(TEST_DATABASE_URL);
  adminUrl.pathname = '/postgres';

  const client = new pg.Client({ connectionString: adminUrl.toString() });
  try {
    await client.connect();
  } catch {
    throw new Error(
      `Cannot reach the test database at ${url.host}. Start it with \`pnpm db:up\`.`,
    );
  }
  const exists = await client.query(
    'SELECT 1 FROM pg_database WHERE datname = $1',
    [dbName],
  );
  if (exists.rowCount === 0) {
    if (!/^[a-z_][a-z0-9_]*$/.test(dbName)) throw new Error('Bad test DB name');
    await client.query(`CREATE DATABASE "${dbName}"`);
  }
  await client.end();

  execFileSync('pnpm', ['exec', 'prisma', 'migrate', 'deploy'], {
    cwd: path.resolve(import.meta.dirname, '../../../../packages/db'),
    env: { ...process.env, DATABASE_URL: TEST_DATABASE_URL },
    stdio: 'pipe',
  });
}

import { tmpdir } from 'node:os';
import path from 'node:path';
import { defineConfig } from '@playwright/test';

const PORT = 4300;
export const E2E_DATA_DIR = path.join(tmpdir(), 'stackdock-e2e-data');
export const E2E_DATABASE_URL =
  process.env.TEST_DATABASE_URL ??
  'postgresql://postgres:postgres@localhost:5433/stackdock_test';

/**
 * Browser tests against the real production build: NestJS serving the static
 * UI + API on one port, using the `stackdock_test` database.
 * Requires `pnpm db:up` and `pnpm build`. Uses the locally installed Chrome.
 */
export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: 'list',
  globalSetup: './e2e/global-setup.ts',
  use: {
    baseURL: `http://localhost:${PORT}`,
    channel: process.env.PLAYWRIGHT_CHANNEL ?? 'chrome',
    trace: 'retain-on-failure',
  },
  webServer: [
    {
      command: 'node e2e/mock-northflank.mjs',
      url: 'http://127.0.0.1:4310/health',
      reuseExistingServer: false,
    },
    {
      command: 'node ../api/dist/main.js',
      // Show server logs when PLAYWRIGHT_SERVER_LOGS=1 (debugging).
      stdout: process.env.PLAYWRIGHT_SERVER_LOGS ? 'pipe' : 'ignore',
      stderr: 'pipe',
      // Let StackDock stop its project processes cleanly.
      gracefulShutdown: { signal: 'SIGTERM', timeout: 10_000 },
      url: `http://localhost:${PORT}/api/v1/health`,
      reuseExistingServer: false,
      env: {
        NODE_ENV: 'test',
        API_PORT: String(PORT),
        DATABASE_URL: E2E_DATABASE_URL,
        SESSION_SECRET: 'e2e-session-secret-'.padEnd(40, 'x'),
        CREDENTIAL_ENCRYPTION_KEY: Buffer.alloc(32, 9).toString('base64'),
        WEB_DIST_DIR: path.resolve(import.meta.dirname, 'out'),
        APP_VERSION: 'e2e',
        TRUST_PROXY: '1',
        DATA_DIR: E2E_DATA_DIR,
        RUNNER_ALLOW_LOCAL_REPOS: 'true',
        RUNNER_AUTOSTART: 'false',
        START_TIMEOUT_SECONDS: '20',
        NORTHFLANK_API_URL: 'http://127.0.0.1:4310/v1/',
        // Pretend to run on Northflank (normally injected by Northflank).
        NF_PROJECT_ID: 'e2e-proj',
        NF_OBJECT_ID: 'stackdock',
        NF_HOSTS: 'dash--stackdock--e2e-proj--abc1.code.run',
        ROUTING_MODE: 'northflank-ports',
      },
    },
  ],
});

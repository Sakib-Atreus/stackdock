import { existsSync } from 'node:fs';
import path from 'node:path';
import { defineConfig, env } from 'prisma/config';

// Local CLI use (migrate, studio): load the monorepo root .env if present.
// In production DATABASE_URL comes from the real environment.
const rootEnv = path.resolve(import.meta.dirname, '../../.env');
if (existsSync(rootEnv) && !process.env.DATABASE_URL)
  process.loadEnvFile(rootEnv);

export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: {
    path: 'prisma/migrations',
  },
  // `prisma generate` (e.g. during a Docker build) needs no database, so the
  // URL is only required when it's set; migrate/studio fail clearly without it.
  ...(process.env.DATABASE_URL
    ? { datasource: { url: env('DATABASE_URL') } }
    : {}),
});

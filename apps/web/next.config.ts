import { existsSync } from 'node:fs';
import path from 'node:path';
import type { NextConfig } from 'next';
import { PHASE_DEVELOPMENT_SERVER } from 'next/constants';

/**
 * Static export (docs/decisions.md D-03): `next build` writes plain HTML/JS/CSS
 * to `out/`, which the NestJS API serves in production. No Next.js server runs.
 * Consequences: no server actions, cookies(), rewrites, middleware, or dynamic
 * routes without generateStaticParams — use query params instead.
 */
export default function config(phase: string): NextConfig {
  if (phase === PHASE_DEVELOPMENT_SERVER) {
    // Dev only: read NEXT_PUBLIC_API_URL from the monorepo root .env.
    // Production builds never load it, so the UI calls its own origin.
    const rootEnv = path.resolve(import.meta.dirname, '../../.env');
    if (existsSync(rootEnv)) process.loadEnvFile(rootEnv);
  }

  return {
    output: 'export',
    images: { unoptimized: true },
    turbopack: {
      rules: {
        '*.css': {
          loaders: ['@tailwindcss/turbopack'],
          as: '*.css',
        },
      },
    },
  };
}

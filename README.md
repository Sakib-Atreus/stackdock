# StackDock

A private, single-admin deploy dashboard. StackDock runs your own Node.js, Python, Go and PHP projects **inside one container**, gives each its own URL, and can talk to the Northflank API.

> Status: **Phase 4 (project registry)** done. Private login, the Northflank connection, the activity log, and a registry of projects with encrypted environment variables work. Building and running projects comes in Phase 5. See [`docs/implementation-plan.md`](docs/implementation-plan.md) and [`docs/decisions.md`](docs/decisions.md).

## Stack

Monolith monorepo (pnpm workspaces + Turborepo), built into **one Docker image / one Node process**:

| Path              | What                                                                                                           |
| ----------------- | -------------------------------------------------------------------------------------------------------------- |
| `apps/api`        | NestJS 12 (ESM). The only server process: API at `/api/v1`, serves the web UI, and (later) proxies to projects |
| `apps/web`        | Next.js 16 static export + Tailwind 4 + shadcn/ui. Built to `apps/web/out`, served by the API                  |
| `packages/db`     | Prisma 7 schema, migrations and client (`pg` driver adapter)                                                   |
| `packages/shared` | Zod schemas and types shared by web and api                                                                    |
| `packages/config` | Shared tsconfig and oxlint config                                                                              |

## Prerequisites

- Node.js **24 LTS** (`.nvmrc`)
- pnpm **12** (`corepack enable` or `npm i -g pnpm`)
- Docker (for the local Postgres)

## First-time setup

```bash
pnpm install

# 1. Environment: copy the example, then generate real local secrets
cp .env.example .env
# Replace SESSION_SECRET with:            openssl rand -base64 48
# Replace CREDENTIAL_ENCRYPTION_KEY with: openssl rand -base64 32

# 2. Database (Postgres 17 on localhost:5433)
pnpm db:up
pnpm build                 # also generates the Prisma client
pnpm db:migrate            # applies migrations to the local DB

# 3. Create your admin account (one time; asks for email + password)
pnpm admin:create
```

There is no sign-up page. If you forget your password, run `pnpm admin:reset-password` (needs shell access to the server). It also signs out every session.

Never commit `.env`. It's in `.gitignore`.

## Development

```bash
pnpm dev
```

- UI: http://localhost:3000 (Next.js dev server, hot reload)
- API: http://localhost:4000/api/v1/health

In dev, the UI calls the API using `NEXT_PUBLIC_API_URL`, and CORS allows `WEB_URL` only. Production builds never include that URL.

## Production-style run (locally)

```bash
pnpm build
node apps/api/dist/main.js   # serves UI + API on API_PORT (or PORT)
```

Open http://localhost:4000.

## Checks

```bash
pnpm lint          # oxlint
pnpm typecheck     # tsc
pnpm test          # vitest: unit + API integration tests (needs `pnpm db:up`)
pnpm test:e2e      # Playwright browser tests (needs `pnpm db:up` + `pnpm build`, uses local Chrome)
pnpm format:check  # prettier
pnpm check         # all of the above + build
```

## Useful commands

| Command                              | What it does                                                              |
| ------------------------------------ | ------------------------------------------------------------------------- |
| `pnpm db:up` / `pnpm db:down`        | Start/stop local Postgres                                                 |
| `pnpm db:migrate`                    | Create/apply a migration after editing `packages/db/prisma/schema.prisma` |
| `pnpm db:deploy`                     | Apply existing migrations (production style, no new migrations)           |
| `pnpm admin:create`                  | Create the first (and only) admin. Refuses if one exists                  |
| `pnpm admin:reset-password`          | Set a new admin password and sign out all sessions                        |
| `pnpm secrets:reencrypt`             | Re-encrypt stored secrets with the current key (key rotation)             |
| `pnpm --filter @stackdock/db studio` | Browse the DB in Prisma Studio                                            |

## Environment variables

See [`.env.example`](.env.example). The API validates them at startup and refuses to start if any are invalid. Errors list variable **names** only, never values.

| Variable                    | Required | Notes                                                   |
| --------------------------- | -------- | ------------------------------------------------------- |
| `DATABASE_URL`              | yes      | Postgres connection URL                                 |
| `SESSION_SECRET`            | yes      | ≥ 32 chars                                              |
| `CREDENTIAL_ENCRYPTION_KEY` | yes      | base64 of exactly 32 bytes                              |
| `API_PORT` / `PORT`         | no       | `PORT` (set by Northflank) wins; default 4000           |
| `WEB_URL`                   | dev only | Origin allowed by CORS in development                   |
| `NEXT_PUBLIC_API_URL`       | dev only | Read by `next dev` only                                 |
| `ROUTING_MODE`              | no       | `northflank-ports` \| `path` \| `host` (default `path`) |
| `APP_VERSION`               | no       | Shown in health check                                   |
| `WEB_DIST_DIR`              | no       | Override location of the built UI                       |

## Security model (summary)

- One admin, created from the command line. No sign-up or setup page.
- Passwords: Argon2id (m=19 MiB, t=2, p=1), minimum 12 characters.
- Sessions: random 256-bit token in an `HttpOnly`, `SameSite=Lax` cookie (`Secure` + `__Host-` prefix in production). The DB stores only an HMAC of the token. 7-day maximum, 24h idle timeout.
- Every API route requires a session unless explicitly marked public (`/health`, `/auth/login`, `/auth/logout`, `/auth/session`).
- CSRF: state-changing requests need the `X-Requested-With: stackdock` header plus a same-origin `Origin`.
- Rate limits: login 5/min and 20/hour per IP. Everything else 300/min.
- Login errors are generic, and unknown emails take the same time as wrong passwords.
- Audit log: logins (success and failure), logouts, password changes and resets, provider connect/test/disconnect. Never passwords or tokens.
- Secrets at rest: AES-256-GCM with a per-record random IV, the record's context bound as AAD (a ciphertext can't be moved to another row), and key versioning for rotation. The key lives only in the environment.
- Northflank calls: fixed paths in server code only (no URL pass-through), 10 s timeout, GET-only retries, `x-ratelimit-reset` honoured. Tokens and provider response bodies are never logged or returned.

## Projects

Projects → **New project** registers a public GitHub repo: short name (1–8 chars, permanent, becomes the project URL), branch, folder, language (or auto-detect), optional install/build/start commands and health-check path. Saving only records it. Nothing is built until Phase 5's deploy.

- **Environment variables** are encrypted (AAD bound to project + key), never shown again, and only key names are logged. `PORT`, `BASE_PATH`, `HOST`, `NODE_OPTIONS` and `STACKDOCK_*` are reserved.
- **Archive** hides a project and stops it in StackDock. It's reversible and never touches GitHub or Northflank.
- **Delete permanently** only works on archived projects and requires typing the short name. It removes the record and its variables.

## Connecting Northflank

Settings → **Northflank connection**. Create a **team** API token with a dedicated API role that has only:

- Project › Projects › Manage › Read
- Project › Services › General › Read
- Project › Services › General › Update (for triggering builds and per-project ports, in later phases)

StackDock verifies the token with `GET /v1/auth` before saving it, stores it AES-256-GCM encrypted, and only ever shows its last 4 characters. "Disconnect" deletes StackDock's copy. It does not revoke the token in Northflank or touch any Northflank resource.

## Key rotation

Stored secrets are encrypted with `CREDENTIAL_ENCRYPTION_KEY`. Each ciphertext records its key version. To rotate:

1. Generate a new key: `openssl rand -base64 32`
2. Set `CREDENTIAL_ENCRYPTION_KEY_PREVIOUS` = the old key, `CREDENTIAL_ENCRYPTION_KEY` = the new key, `CREDENTIAL_KEY_VERSION` = old version + 1. Restart.
3. Run `pnpm secrets:reencrypt`. It must report `failed 0`.
4. Remove `CREDENTIAL_ENCRYPTION_KEY_PREVIOUS` and restart.

If the key is **lost**, stored secrets can't be recovered. Reconnect Northflank (and later re-enter project env vars). Keep a copy of the key in a password manager.

## Deployment

Not yet. Phase 7 adds the Dockerfile and Northflank deployment. Nothing is created on Northflank without explicit confirmation.

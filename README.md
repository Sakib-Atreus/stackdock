# StackDock

A private, single-admin deploy dashboard. StackDock runs your own Node.js, Python, Go and PHP projects **inside one container**, gives each its own URL, and can talk to the Northflank API.

> Status: **Phase 7 (production)** ready. Production Docker image verified locally with real GitHub sample apps in all four languages. See [Deploying to Northflank](#deploying-to-northflank).

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

| Variable                                    | Required   | Notes                                                                                                     |
| ------------------------------------------- | ---------- | --------------------------------------------------------------------------------------------------------- |
| `DATABASE_URL`                              | yes        | Postgres connection URL                                                                                   |
| `SESSION_SECRET`                            | yes        | ≥ 32 chars                                                                                                |
| `CREDENTIAL_ENCRYPTION_KEY`                 | yes        | base64 of exactly 32 bytes                                                                                |
| `API_PORT` / `PORT`                         | no         | `PORT` (set by Northflank) wins; default 4000                                                             |
| `WEB_URL`                                   | dev only   | Origin allowed by CORS in development                                                                     |
| `NEXT_PUBLIC_API_URL`                       | dev only   | Read by `next dev` only                                                                                   |
| `DATA_DIR`                                  | no         | Checkouts, caches, pid files (default `.data`; Docker: `/data`)                                           |
| `PROJECT_MEMORY_MB`                         | no         | Heap limit for Node projects (default 256)                                                                |
| `MAX_RUNNING_PROJECTS`                      | no         | Default 10                                                                                                |
| `BUILD_STEP_TIMEOUT_SECONDS`                | no         | Per install/build step (default 900)                                                                      |
| `START_TIMEOUT_SECONDS`                     | no         | Time to become healthy (default 90)                                                                       |
| `MAX_REPO_SIZE_MB`                          | no         | Default 500                                                                                               |
| `RUNNER_AUTOSTART`                          | no         | Restart projects on boot (default `true`)                                                                 |
| `PROJECT_DB_ADMIN_URL`                      | prod       | Admin connection for creating project DBs (Northflank: the addon's admin URI). Defaults to `DATABASE_URL` |
| `RUNNER_ALLOW_LOCAL_REPOS`                  | tests only | Allows `file://` repos; refused in production                                                             |
| `NF_PROJECT_ID`, `NF_OBJECT_ID`, `NF_HOSTS` | auto       | Injected by Northflank at runtime; don't set them yourself                                                |
| `MIGRATE_ON_START`                          | no         | Docker image: apply migrations on start (default `true`)                                                  |
| `ROUTING_MODE`                              | no         | `northflank-ports` \| `path` \| `host` (default `path`)                                                   |
| `APP_VERSION`                               | no         | Shown in health check                                                                                     |
| `WEB_DIST_DIR`                              | no         | Override location of the built UI                                                                         |

## Security model (summary)

- One admin, created from the command line. No sign-up or setup page.
- Passwords: Argon2id (m=19 MiB, t=2, p=1), minimum 12 characters.
- Sessions: random 256-bit token in an `HttpOnly`, `SameSite=Lax` cookie (`Secure` + `__Host-` prefix in production). The DB stores only an HMAC of the token. 7-day maximum, 24h idle timeout.
- Every API route requires a session unless explicitly marked public (`/health`, `/auth/login`, `/auth/logout`, `/auth/session`).
- CSRF: state-changing requests need the `X-Requested-With: stackdock` header plus a same-origin `Origin`.
- CSP: `script-src 'self'` plus exact SHA-256 hashes of the UI's inline scripts (no `'unsafe-inline'`), `frame-ancestors 'none'`, HSTS, nosniff, no-referrer. Browser tests fail on any CSP violation.
- Route protection is enforced by a test that lists every API route and allows exactly 4 public ones.
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

## Deploying projects (runner)

Press **Deploy** on a project. StackDock then:

1. Queues the build. Builds run **one at a time** to protect memory.
2. Shallow-clones the branch from public GitHub. There are no credentials, prompts, hooks or submodules, and a size limit applies (`MAX_REPO_SIZE_MB`).
3. Detects the language, unless you chose one, and runs install and build. Each step has a time limit (`BUILD_STEP_TIMEOUT_SECONDS`).

   | Language | Detected by                          | Default install · build · start                                                                                                       |
   | -------- | ------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------- |
   | Node.js  | `package.json`                       | `npm ci` / `pnpm` / `yarn` by lockfile · `<pm> run build` if a build script exists · `<pm> start`, else `node server.js` / `index.js` |
   | Python   | `requirements.txt`, `pyproject.toml` | venv in `.venv` + `pip install` · none · gunicorn/uvicorn if listed, else `python app.py` / `main.py`                                 |
   | Go       | `go.mod`                             | `go mod download` · `go build -o ./.stackdock/bin/app .` · `./.stackdock/bin/app`                                                     |
   | PHP      | `composer.json`, `index.php`         | `composer install --no-dev` · none · `php -S 127.0.0.1:$PORT -t public`                                                               |

4. Starts the app with `PORT`, `HOST=127.0.0.1`, `BASE_PATH=/apps/<name>`, `NODE_ENV=production`, your env vars, and `DATABASE_URL` if the project has a database. **Your app must listen on `$PORT`.**
5. Waits until it's healthy (your health path answers < 400, or the port opens; `START_TIMEOUT_SECONDS`).
6. **Zero-downtime switch:** the new version runs next to the old one, and traffic moves only once it's healthy. A failed deploy never takes down the running version.

Then:

- **Routing:** `https://<stackdock>/apps/<name>/…` is proxied with the prefix removed (WebSockets work). Each project can also get its own URL via a Northflank port (see below, `ROUTING_MODE=northflank-ports`).
- **Crashes** restart automatically with backoff (1s, 2s, 4s…). After more than 5 crashes in 10 minutes the project is marked **Crashed**.
- **StackDock restart:** projects that were running come back automatically. An existing build is reused when it's still on disk; otherwise (e.g. Northflank wiped the disk) they're rebuilt.
- **Stop / Restart / Start last build** don't rebuild. **Cancel** stops a queued or running deploy.
- **Logs:** the build log is saved per deployment, and the last 1000 runtime lines are kept in memory. Values of the project's env vars and DB password are replaced with `••••`.
- **Isolation:** project processes get a fresh environment with **no StackDock secrets**. The StackDock session cookie is removed from proxied requests, and projects can't set it. Projects are **not sandboxed** from each other or from StackDock (same OS user, same container), so only deploy repos you own and trust (D-06).

### Per-project database

**Create database** makes `proj_<name>` with its own login (`proj_<name>_user`) inside StackDock's Postgres, and gives the app `DATABASE_URL` on the next deploy. Other projects can't connect to it, and project users can't read StackDock's tables. It works with a non-superuser admin (e.g. Northflank's addon admin) via `PROJECT_DB_ADMIN_URL`. Deleting a database requires typing the project name, and a project with a database can't be deleted until its database is.

### Testing all runtimes

Your machine may not have Go/PHP. The Docker `test` target has every runtime:

```bash
docker build --target test -t stackdock:test .
docker run --rm --add-host=host.docker.internal:host-gateway \
  -e TEST_DATABASE_URL=postgresql://postgres:postgres@host.docker.internal:5433/stackdock_test \
  stackdock:test pnpm --filter @stackdock/api test
```

## Connecting Northflank

Settings → **Northflank connection**. Create a **team** API token with a dedicated API role that has only:

- Project › Projects › Manage › Read
- Project › Services › General › Read
- Project › Services › General › Update (for triggering builds and per-project ports, in later phases)

StackDock verifies the token with `GET /v1/auth` before saving it, stores it AES-256-GCM encrypted, and only ever shows its last 4 characters. "Disconnect" deletes StackDock's copy. It does not revoke the token in Northflank or touch any Northflank resource.

### What the Northflank page does

- **Browse:** pick a Northflank project, see its services (type, build and deploy status), and open a service to see its recent builds. Reads are cached for 15 s (Northflank allows 1000 API requests/hour). **Refresh** bypasses the cache.
- **Start build** (combined/build services): asks for the branch and confirms first, because a GitHub push may already trigger a build. Never retried automatically, and recorded in the activity log.
- **StackDock's own service:** when running on Northflank, StackDock reads its own IDs from `NF_PROJECT_ID`/`NF_OBJECT_ID` and its public URLs from `NF_HOSTS` (all injected by Northflank).

### One URL per project

On a project's page, **Get own URL** adds a public HTTP port named after the project (e.g. `shop` → internal port 10001) to StackDock's own Northflank service, so the project gets `https://shop--<service>--…code.run/`. Requirements:

- StackDock runs on Northflank with `ROUTING_MODE=northflank-ports`.
- The token's role has _Project › Services › General › Update_ on StackDock's project.

Northflank **restarts StackDock** to apply port changes, so all projects restart briefly (they come back automatically). StackDock always sends the **complete** port list and keeps existing ports and their settings. **Remove** deletes just that port. A project with its own URL can't be deleted until the URL is removed.

## Key rotation

Stored secrets are encrypted with `CREDENTIAL_ENCRYPTION_KEY`. Each ciphertext records its key version. To rotate:

1. Generate a new key: `openssl rand -base64 32`
2. Set `CREDENTIAL_ENCRYPTION_KEY_PREVIOUS` = the old key, `CREDENTIAL_ENCRYPTION_KEY` = the new key, `CREDENTIAL_KEY_VERSION` = old version + 1. Restart.
3. Run `pnpm secrets:reencrypt`. It must report `failed 0`.
4. Remove `CREDENTIAL_ENCRYPTION_KEY_PREVIOUS` and restart.

If the key is **lost**, stored secrets can't be recovered. Reconnect Northflank (and later re-enter project env vars). Keep a copy of the key in a password manager.

## Deploying to Northflank

StackDock is **one container** plus **one PostgreSQL addon**. The image (`Dockerfile`, default target `production`) contains Node 24, Python 3.13, Go 1.27 and PHP 8.4 so projects can be built inside it. It runs as a non-root user, applies database migrations on start, and has a health check.

### Resources it needs (free Sandbox: 2 services, 1 addon, 2 projects)

| #   | Resource                             | Settings                                                                                                                                                                                                             |
| --- | ------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | **Project** `stackdock`              | Any region                                                                                                                                                                                                           |
| 2   | **Addon** PostgreSQL `stackdock-db`  | Smallest plan, 1 replica, **not publicly accessible**. Enable a backup schedule if your plan offers it                                                                                                               |
| 3   | **Secret group** `stackdock-secrets` | Linked to the addon: `DATABASE_URL` ← `POSTGRES_URI`, `PROJECT_DB_ADMIN_URL` ← the admin URI (the one ending in `_ADMIN`). Plus `SESSION_SECRET` and `CREDENTIAL_ENCRYPTION_KEY` (see below)                         |
| 4   | **Combined service** `stackdock`     | GitHub repo + branch `main` · build with **Dockerfile** `/Dockerfile`, context `/` · port **`dash` → 8080, HTTP, public** · 1 instance, smallest compute plan available · health check HTTP `/api/v1/health` on 8080 |

Service environment variables (non-secret):

```dotenv
NODE_ENV=production
PORT=8080
ROUTING_MODE=northflank-ports
TRUST_PROXY=1
DATA_DIR=/data
```

Generate the two secrets **on your own computer** and paste them only into Northflank's secret group (and keep a copy in a password manager):

```bash
openssl rand -base64 48   # SESSION_SECRET
openssl rand -base64 32   # CREDENTIAL_ENCRYPTION_KEY
```

### After the first deploy

1. Wait for the health check to pass, then open the service **Shell** in Northflank and run:
   ```bash
   node apps/api/dist/cli/admin.js create
   ```
2. Open `https://dash--stackdock--…code.run`, sign in, and connect Northflank in **Settings** with a **team** API token (see [Connecting Northflank](#connecting-northflank)).
3. Add projects. **Get own URL** adds a port per project (StackDock restarts to apply it).

### Notes

- **Name the dashboard port `dash`.** Project names can't be `dash`, so they never clash.
- **Builds are heavy:** the image is about 1.6 GB, so the first build takes several minutes.
- **Disk:** Northflank's container disk is wiped on restart. StackDock rebuilds projects that should be running (D-05). Each project's build and the shared download caches live in `/data` (expect a few hundred MB).
- **Memory:** measured locally, StackDock with 4 small sample apps (Node, Django, Go, PHP) idles at about 230 MB.
- **Migrations** run automatically on every start (`MIGRATE_ON_START=true`). Set it to `false` to run them yourself (`cd packages/db && ./node_modules/.bin/prisma migrate deploy`).
- **Quotas and billing** are Northflank's. StackDock never creates Northflank resources by itself except the per-project ports you confirm.

## Running the production image locally (or on your own server)

```bash
cp .env.example .env.prod      # set POSTGRES_PASSWORD, SESSION_SECRET, CREDENTIAL_ENCRYPTION_KEY
docker compose -f docker-compose.prod.yml --env-file .env.prod up -d --build
docker compose -f docker-compose.prod.yml exec stackdock node apps/api/dist/cli/admin.js create
```

StackDock is then on http://127.0.0.1:8080 (only reachable from this machine; put HTTPS in front of it, e.g. a Cloudflare Tunnel, before exposing it).

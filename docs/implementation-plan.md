# StackDock — Implementation Plan (Phase 0)

> Status: **Draft for review** — no code written, no cloud resources created.
> Date: 2026-11-20
> Source spec: `~/Downloads/personal-deployment-dashboard-spec.md` (modified by decisions in `docs/decisions.md`)

---

## 1. What StackDock is (updated direction)

StackDock is a **private, single-admin deploy dashboard** that runs as **one container**.
Inside that container it can:

1. **Run your own projects** — clone a GitHub repo, install, build, start it as a child process, and route traffic to it (`https://<stackdock-domain>/apps/<slug>/...`).
2. **Talk to the Northflank API** (optional extra) — list projects/services, see build/deploy status, trigger builds.

It is an **experiment**. Target hosts:

| Stage | Host                                     | Notes                                                                                               |
| ----- | ---------------------------------------- | --------------------------------------------------------------------------------------------------- |
| Now   | Northflank, 1 service + 1 Postgres addon | Free Sandbox plan                                                                                   |
| Later | Your laptop as always-on server          | Same Docker image; Postgres via docker-compose; public access via a tunnel (e.g. Cloudflare Tunnel) |

The same Docker image must run in both places. No Northflank-only dependency in the core.

---

## 2. Research findings (verified 2026-11-20)

### 2.1 Northflank free plan (Sandbox) — from https://northflank.com/pricing

| Item                             | Free Sandbox      |
| -------------------------------- | ----------------- |
| Services                         | 2                 |
| Jobs                             | 2                 |
| Addons (databases)               | 1                 |
| Projects                         | 2                 |
| Credit card                      | Not required      |
| Always on                        | Yes (no sleeping) |
| Custom domains + TLS             | Yes               |
| Horizontal scaling / autoscaling | **No**            |

**Not confirmed from public docs** (must check in the Northflank dashboard before deploying):

- Which compute plan (CPU/RAM) a free service may use. Smallest public plans: `nf-compute-10` = 0.1 vCPU / 256 MB, `nf-compute-20` = 0.2 vCPU / 512 MB.
- Ephemeral disk size for free services (general default quota is 2 GiB per instance).
- Whether persistent volumes are allowed on free projects, and their size.

**Planning assumption:** the container gets **≈512 MB RAM and ≈0.2 vCPU**, with a **wiped disk on every restart**. The design must survive that.

### 2.2 Northflank API — from https://northflank.com/docs/v1/api

| Item              | Verified value                                                                                  |
| ----------------- | ----------------------------------------------------------------------------------------------- |
| Base URL          | `https://api.northflank.com/v1/`                                                                |
| Auth              | `Authorization: Bearer <token>`                                                                 |
| Token types       | Personal (account settings) or team token tied to an **API role** with granular permissions     |
| Rate limit        | 1000 requests / hour; headers `x-ratelimit-limit`, `x-ratelimit-remaining`, `x-ratelimit-reset` |
| Pagination        | Query `per_page` (1–100), `page`, `cursor`; response `pagination.{hasNextPage, cursor, count}`  |
| Response envelope | `{ data: {...}, pagination?: {...} }`                                                           |

### 2.3 Confirmed API capabilities (for the optional Northflank module)

| Capability                                                     | Endpoint                                                                             | Required permission                   | Confirmed                                            |
| -------------------------------------------------------------- | ------------------------------------------------------------------------------------ | ------------------------------------- | ---------------------------------------------------- |
| List projects                                                  | `GET /v1/projects`                                                                   | Project > Projects > Manage > Read    | ✅                                                   |
| List services                                                  | `GET /v1/projects/{projectId}/services`                                              | Project > Services > General > Read   | ✅ (includes `status.build` and `status.deployment`) |
| Get service                                                    | `GET` service by id (exact path to be re-checked in Phase 4)                         | Project > Services > General > Read   | ✅ exists                                            |
| List builds (history)                                          | `GET /v1/projects/{projectId}/services/{serviceId}/build`                            | Project > Services > General > Read   | ✅                                                   |
| Trigger build                                                  | `POST /v1/projects/{projectId}/services/{serviceId}/build` (body: `branch` or `sha`) | Project > Services > General > Update | ✅                                                   |
| List deployments, restart, pause/resume, logs, metrics, health | Listed in API nav                                                                    | TBD                                   | ⚠️ exists — paths/schemas verify in Phase 4/6        |

Status values returned by Northflank:

- Build: `QUEUED, PENDING, UNSCHEDULABLE, STARTING, CLONING, BUILDING, UPLOADING, ABORTED, FAILURE, SUBMISSION_FAILURE, SUCCESS, CRASHED, IN_PROGRESS`
- Deployment: `PENDING, IN_PROGRESS, COMPLETED, FAILED` (reason `SCALING` | `DEPLOYING`)

Full OpenAPI spec for typed client generation: `https://api.northflank.com/v1/swagger-json`.

### 2.4 Terms of service risk — from https://northflank.com/legal/terms (effective 1 March 2021)

No clause explicitly forbids running several apps in one service. But the terms prohibit:

- creating "an undue burden on the Services",
- attempting "to bypass any measures of the Services designed to prevent or restrict access",
- commercial use without approval,
  and Northflank may deny access or suspend accounts at its discretion.

**Conclusion:** running multiple personal projects inside one free service is a grey area. Keep it a personal, low-traffic, non-commercial experiment. Don't depend on it for anything important. The laptop host removes this risk.

---

## 3. Architecture

### 3.1 Choice: monolith monorepo, Next.js + NestJS, **one Node process at runtime**

- **`apps/web`** — Next.js (App Router, TypeScript, Tailwind, shadcn/ui), built as a **static export** (`output: 'export'`). It's a dashboard behind login, so it needs no SSR.
- **`apps/api`** — NestJS. It is the **only server process**. It serves:
  - `/api/v1/*` → dashboard API
  - `/apps/<slug>/*` → reverse-proxy to the matching child project
  - everything else → static files of `apps/web`
- **Projects** run as **child processes** started by the NestJS runner module.

Why one process: with ≈512 MB RAM, a Next.js server + NestJS + your projects would leave almost nothing for projects. A static Next.js export costs **zero** RAM at runtime. (See decision D-03.)

```text
Internet ──► Northflank service (1 container, one public port per project)
   dash--svc--x.code.run ─► :8080  NestJS
                                 ├── /api/v1/*       → auth, projects, runner, northflank, activity
                                 ├── /apps/<slug>/*  → fallback proxy to a project
                                 └── /*              → Next.js static files (apps/web/out)
   shop--svc--x.code.run ─► :10001 NestJS listener → 127.0.0.1:20001 (shop process)
   blog--svc--x.code.run ─► :10002 NestJS listener → 127.0.0.1:20002 (blog process)
               Postgres addon (private, not public)
```

### 3.2 Repository layout

```text
stackdock/
├── apps/
│   ├── web/                       # Next.js frontend (static export)
│   │   └── src/{app,components,lib}
│   └── api/                       # NestJS backend (single runtime process)
│       └── src/
│           ├── main.ts
│           ├── app.module.ts
│           ├── common/            # guards, filters, interceptors, pipes
│           ├── config/            # env validation (Zod)
│           └── modules/
│               ├── auth/          # login, sessions, rate limit, admin bootstrap
│               ├── projects/      # project registry (CRUD)
│               ├── runner/        # clone → install → build → start/stop/restart, logs, health
│               ├── proxy/         # /apps/<slug> routing to child processes
│               ├── secrets/       # encrypted env vars for projects + provider tokens
│               ├── northflank/    # optional Northflank API client
│               ├── activity/      # audit log
│               └── health/
├── packages/
│   ├── db/                        # Prisma schema, migrations, client
│   ├── shared/                    # Zod schemas + types shared by web and api
│   └── config/                    # shared tsconfig, eslint, prettier
├── docs/
│   ├── implementation-plan.md
│   └── decisions.md
├── Dockerfile                     # multi-stage → one image
├── docker-compose.yml             # local Postgres (+ optional full stack for laptop)
├── pnpm-workspace.yaml
├── turbo.json
├── package.json
├── .env.example
├── .gitignore
└── README.md
```

Tooling: Node.js 24 LTS (D-16), pnpm workspaces, Turborepo, strict TypeScript, ESLint + Prettier, Vitest (unit/integration), Playwright (e2e).

### 3.3 How the runner works

For each registered project:

1. **Clone** the GitHub repo (shallow, given branch) into `/data/projects/<slug>/<commit>`.
2. **Install** using the lockfile it finds (`pnpm`/`npm`/`yarn`).
3. **Build** with the project's build command (optional).
4. **Start** with the project's start command, with env:
   - `PORT=<internal port>` (assigned by StackDock, bound to `127.0.0.1`)
   - `BASE_PATH=/apps/<slug>`
   - the project's own decrypted env vars
   - **none** of StackDock's own secrets (DB URL, session secret, encryption key are stripped)
5. **Health check** the project's health path. Mark it `RUNNING` only after it passes.
6. **Supervise**: capture stdout/stderr into a ring buffer (redacted), auto-restart on crash with backoff, enforce a memory limit via `--max-old-space-size` for Node projects.
7. **On container boot**: re-clone and start every project marked "should run". The disk is wiped on restart (see D-05).

Supported project types in MVP: **Node.js only** (decision D-04).

Routing (D-15): each project has its own Northflank public port and URL. StackDock adds the port through the Northflank API (this redeploys the service). Fallback: `/apps/<slug>/...` on the dashboard URL, forwarded with the prefix **stripped**, so a backend API listening on `/` works unchanged. Frontend apps that use absolute asset paths must respect `BASE_PATH`.

### 3.4 Data model (Prisma, Postgres)

| Model                | Key fields                                                                                                                                                                                                                                                                                                                         |
| -------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `AdminUser`          | id, email (unique), passwordHash (Argon2id), timestamps                                                                                                                                                                                                                                                                            |
| `Session`            | id, userId, tokenHash, expiresAt, createdAt, lastSeenAt                                                                                                                                                                                                                                                                            |
| `Project`            | id, slug (unique, 1–8 chars = Northflank port name), publicPort (unique, e.g. 10001), privatePort, name, description, repoUrl, branch, installCommand?, buildCommand?, startCommand, rootDir (default `.`), healthCheckPath?, desiredState (`RUNNING`/`STOPPED`), status, lastCommitSha?, lastDeployedAt?, timestamps, archivedAt? |
| `ProjectDatabase`    | id, projectId, dbName, roleName, encryptedPassword, keyVersion, createdAt                                                                                                                                                                                                                                                          |
| `ProjectEnvVar`      | id, projectId, key, encryptedValue, keyVersion, timestamps. Values are never returned to the browser                                                                                                                                                                                                                               |
| `Deployment`         | id, projectId, commitSha, status (`QUEUED`/`CLONING`/`INSTALLING`/`BUILDING`/`STARTING`/`RUNNING`/`FAILED`/`STOPPED`), startedAt, finishedAt, safeErrorSummary                                                                                                                                                                     |
| `ProviderConnection` | id, provider (`NORTHFLANK`), encryptedCredential, keyVersion, status, lastTestedAt, lastErrorCode, timestamps                                                                                                                                                                                                                      |
| `NorthflankLink`     | id, projectId?, nfProjectId, nfServiceId (optional link of local record to a NF service)                                                                                                                                                                                                                                           |
| `ActivityLog`        | id, action, targetType, targetId, status, safeMetadata (JSON), createdAt                                                                                                                                                                                                                                                           |

Migrations via `prisma migrate`. No `db push` in production.

### 3.5 Dashboard API (our routes)

```text
POST   /api/v1/auth/login            POST /api/v1/auth/logout       GET /api/v1/auth/session
GET    /api/v1/dashboard/summary

GET    /api/v1/projects              POST   /api/v1/projects
GET    /api/v1/projects/:id          PATCH  /api/v1/projects/:id     DELETE /api/v1/projects/:id (archive)
POST   /api/v1/projects/:id/deploy   POST   /api/v1/projects/:id/stop
POST   /api/v1/projects/:id/restart  GET    /api/v1/projects/:id/deployments
POST   /api/v1/projects/:id/expose   DELETE /api/v1/projects/:id/expose   (add/remove NF public port, confirmed)
GET    /api/v1/projects/:id/logs     (redacted, recent lines)
GET    /api/v1/projects/:id/env      (keys + "set" flag only)
PUT    /api/v1/projects/:id/env/:key DELETE /api/v1/projects/:id/env/:key

GET    /api/v1/providers
POST   /api/v1/providers/northflank/connect   POST /api/v1/providers/northflank/test
DELETE /api/v1/providers/northflank
GET    /api/v1/northflank/projects
GET    /api/v1/northflank/projects/:projectId/services
GET    /api/v1/northflank/projects/:projectId/services/:serviceId/builds
POST   /api/v1/northflank/projects/:projectId/services/:serviceId/build

GET    /api/v1/activity
GET    /api/v1/health                (public, no secrets)
```

No generic "proxy any Northflank URL" endpoint (SSRF).

### 3.6 Frontend pages

Overview · Projects (list, detail, new/edit, env vars, logs, deploy history) · Northflank (projects → services → builds) · Activity · Settings (Northflank connection, account/sessions, security notes).
Every page gets loading, empty, error-with-retry and success states, plus a responsive layout and accessible focus states. A visible notice says resources and quotas are controlled by the host (Northflank or laptop).

---

## 4. Security plan (summary)

| Area                    | Plan                                                                                                                                                                         |
| ----------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Admin auth              | One admin, no sign-up. Argon2id. Bootstrap via `pnpm --filter api admin:create` CLI (one-time, refuses if an admin exists)                                                   |
| Sessions                | Random token in HTTP-only, `SameSite=Lax`, `Secure` (prod) cookie. Only the SHA-256 hash is stored in the DB. Expiry + idle timeout                                          |
| CSRF                    | Same-origin app + `SameSite` cookie + required custom header (`X-Requested-With`) on mutating requests + Origin check                                                        |
| Rate limits             | `@nestjs/throttler` on login and on deploy/stop/env routes                                                                                                                   |
| Credential encryption   | AES-256-GCM, key from `CREDENTIAL_ENCRYPTION_KEY` (32 bytes, base64), `keyVersion` stored per record for rotation                                                            |
| Secrets to browser      | Never. API returns masked/`isSet` only                                                                                                                                       |
| Logs                    | Pino with redaction of `authorization`, `cookie`, tokens, and env values. Project log stream also redacts known secret values                                                |
| Child-process isolation | Strip StackDock env; bind to 127.0.0.1; separate working dir. **Not a security boundary** — child code runs as the same OS user. **Only run repos you own and trust** (D-06) |
| Proxy                   | Only routes to registered slugs → fixed localhost ports. Never to user-supplied hosts                                                                                        |
| Input validation        | Zod schemas in `packages/shared`, used by both web and api. Repo URL must be `https://github.com/<owner>/<repo>`                                                             |
| Headers                 | Helmet, strict CORS (same origin only)                                                                                                                                       |

---

## 5. Phases (updated)

| Phase         | Scope                                                                                                                                                                                                               | Deliverable                                           |
| ------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------- |
| **0** ✅      | Research + this plan                                                                                                                                                                                                | ✅ `docs/implementation-plan.md`, `docs/decisions.md` |
| **1** ✅      | Foundation: local `git init` (no push), pnpm + Turborepo, `apps/web`, `apps/api`, `packages/{db,shared,config}`, env validation, local Postgres, health endpoint, NestJS serving static web                         | Runs locally with `pnpm dev`                          |
| **2** ✅      | Auth: admin bootstrap CLI, login/logout/session, guards, rate limit, tests                                                                                                                                          | Private dashboard                                     |
| **3** ✅      | Encryption service + secrets: provider credentials (project env vars reuse it in Phase 4/5)                                                                                                                         | Secrets stored safely                                 |
| **4** ✅      | Project registry: CRUD UI + API, archive                                                                                                                                                                            | Can register projects                                 |
| **5**         | **Runner + proxy + project DBs**: multi-runtime clone/install/build/start/stop/restart, build queue, per-project Postgres DB, supervision, logs, `/apps/<slug>` routing, boot-time restore, tests with a sample app | Projects run inside StackDock                         |
| **6**         | Northflank module: read-only listing, trigger build, **manage StackDock's own ports per project** (D-15), mocked tests                                                                                              | Own URL per project                                   |
| **7**         | Production: Dockerfile, image test locally, docs, **show you exact Northflank resources and ask before creating**, deploy, checklist                                                                                | Live on Northflank                                    |
| **8 (later)** | Laptop hosting: compose file for full stack, tunnel guide, backups                                                                                                                                                  | Runs on your laptop                                   |

After each phase: run lint, typecheck, tests, build, then report changed files, commands and results.

---

## 6. Owner answers (2026-11-20)

| Question          | Answer                                                  | Impact                                                                                                 |
| ----------------- | ------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| Private repos?    | **Public only** (testing)                               | No GitHub token needed. `GITHUB` provider connection dropped from MVP                                  |
| Languages         | **Node.js, Python, Go, PHP**                            | Image ships all 4 runtimes (D-04 revised)                                                              |
| Project databases | **Own database per project, hosted on Northflank**      | One Postgres addon (free limit = 1), one database + user per project (D-12)                            |
| Domain            | **Northflank-provided domain**, **own URL per project** | One public port per project → `https://<slug>--<service>--<random>.code.run` (D-15). Slug max 8 chars  |
| GitHub repo       | **Owner creates it**                                    | Claude makes **no** GitHub writes (push, repo create, PR, settings) without explicit permission (D-13) |

### 6.1 Multi-runtime support (revised D-04)

| Runtime     | Detected by                           | Default install                                                  | Default start                                            |
| ----------- | ------------------------------------- | ---------------------------------------------------------------- | -------------------------------------------------------- |
| Node.js 22  | `package.json`                        | `npm ci` / `pnpm i --frozen-lockfile` / `yarn --frozen-lockfile` | `npm start`                                              |
| Python 3.12 | `requirements.txt` / `pyproject.toml` | `python -m venv .venv && pip install -r requirements.txt`        | must be set (e.g. `gunicorn app:app -b 127.0.0.1:$PORT`) |
| Go 1.2x     | `go.mod`                              | `go build -o ./bin/app .`                                        | `./bin/app`                                              |
| PHP 8.3     | `composer.json` / `index.php`         | `composer install --no-dev`                                      | `php -S 127.0.0.1:$PORT -t public`                       |

Each project may override install, build and start commands. Every project must listen on `$PORT`.

**Cost of this:** the image grows to about 1.5–2 GB. Building Go projects and big `npm install`s can run out of memory in about 512 MB, so builds run **one at a time** (a queue) and a failed build never stops already-running projects.

### 6.2 Per-project databases (D-12)

- StackDock's Postgres addon holds the `stackdock` database plus **one database per project** (`proj_<slug>`), each with its own login role (`proj_<slug>_user`, random password).
- StackDock creates or drops them with the addon **admin** credentials (`ADMIN_USERNAME`/`ADMIN_PASSWORD`, exposed by Northflank). Admin credentials are used only by the provisioning code, never given to projects.
- The project gets `DATABASE_URL` injected automatically (encrypted in `ProjectEnvVar`).
- Each role is `REVOKE`d from other databases (`REVOKE CONNECT ... FROM PUBLIC`).
- Deleting a project's database is a separate, confirmed, logged action.
- Postgres only (no MySQL) in MVP. PHP and Python projects use Postgres drivers.
- ⚠️ To verify at Phase 5: that the Northflank admin user may run `CREATE DATABASE` / `CREATE ROLE`. Fallback: one **schema** per project in a shared DB.
- All projects share the addon's storage and CPU. One heavy project slows the others.

## 7. Assumptions

- One admin user, personal use, low traffic.
- Free Sandbox gives ≈512 MB / 0.2 vCPU for the service. **To verify in your Northflank dashboard before Phase 7.**
- No paid Northflank resources will be created without your explicit confirmation.
- Northflank API integration is secondary; the core runs without a Northflank token.

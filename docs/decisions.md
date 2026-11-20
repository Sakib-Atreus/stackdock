# StackDock — Technical Decisions

Format: ID · date · status · decision · why · trade-offs.

---

### D-01 · 2026-11-20 · Accepted — StackDock is a mini-platform, not only a Northflank control panel

**Decision:** StackDock runs the owner's projects as child processes inside its own container, routes traffic to them, and optionally talks to the Northflank API.
**Why:** The owner wants one hosted service that runs many personal projects underneath, as an experiment, then moves to a self-hosted laptop later.
**Trade-offs:** This goes beyond the original spec's "control panel only" scope and its "no custom runtime" rule, deliberately. Limits: shared CPU/RAM, single runtime, weak isolation, ToS grey area (D-07).

### D-02 · 2026-11-20 · Accepted — Monolith monorepo: pnpm workspaces + Turborepo, `apps/web` (Next.js) + `apps/api` (NestJS)

**Decision:** One repo with `apps/` and `packages/`, built into **one Docker image** and deployed as **one service**.
**Why:** Owner's choice. It keeps a clear frontend/backend split and shared types.
**Trade-offs:** More setup than a single Next.js app.

### D-03 · 2026-11-20 · Proposed — Next.js as static export, served by NestJS (single runtime process)

**Decision:** Build `apps/web` with `output: 'export'`. NestJS serves the static files plus the API plus the project proxy on one port.
**Why:** The free service likely has about 512 MB RAM. Running a Next.js server next to NestJS would cost about 100–150 MB that projects need. A dashboard behind login gains nothing from SSR.
**Trade-offs:** No Next.js server features (server actions, server components that fetch data, middleware). Auth checks happen in the API and the client redirects on 401. Dynamic routes use query params or client routing.
**Alternative:** Run `next start` and NestJS together under a process manager. Revisit on the laptop, where RAM isn't tight.

### D-04 · 2026-11-20 · Accepted (revised) — Support Node.js, Python, Go and PHP projects

**Decision:** The image ships Node 22, Python 3.12, Go and PHP 8.3 (+ Composer). The runtime is auto-detected from repo files, and commands can be overridden per project. Builds run one at a time in a queue.
**Why:** The owner uses all four languages. No Docker-in-Docker on Northflank, so runtimes must live in StackDock's image.
**Trade-offs:** Image about 1.5–2 GB, slower deploys of StackDock itself. Go builds and large installs may run out of memory at about 512 MB. A failed build never stops running projects.

### D-05 · 2026-11-20 · Proposed — Treat the disk as ephemeral; restore projects on boot

**Decision:** Postgres stores the "desired state" (which projects should run, which commit). On boot the runner re-clones, installs and starts them.
**Why:** The container filesystem is wiped on restart/redeploy, and free-plan persistent volumes aren't confirmed.
**Trade-offs:** Slow cold start (install + build per project). Can be improved later with a volume, or on the laptop.

### D-06 · 2026-11-20 · Accepted — Only run trusted repos; child processes are not sandboxed

**Decision:** Child processes get a cleaned env (no StackDock secrets), bind to 127.0.0.1, and use their own working dir. But they run as the same OS user in the same container.
**Why:** True isolation (containers/VMs per project) isn't available inside a Northflank service.
**Trade-offs:** A malicious project could read StackDock files or memory. Acceptable only because all repos belong to the owner.

### D-07 · 2026-11-20 · Accepted (risk) — Northflank ToS grey area

**Finding:** The ToS (effective 2021-03-01) has no explicit ban on multiple apps per service, but forbids "undue burden" and bypassing "measures … designed to … restrict access", and allows suspension at Northflank's discretion.
**Decision:** Keep it personal, non-commercial and low-traffic. Don't run anything important on it. The laptop host (Phase 8) removes the risk.

### D-08 · 2026-11-20 · Superseded by D-15 (kept as fallback) — Path-based routing `/apps/<slug>` with prefix stripping

**Why:** One public port and one domain on Northflank. Prefix stripping lets backend APIs run unchanged.
**Trade-offs:** Frontend apps must respect `BASE_PATH`. Cookies are shared across apps on the same domain. Subdomain routing comes later.

### D-09 · 2026-11-20 · Accepted — Secrets: AES-256-GCM with key versioning

**Decision:** Encrypt provider tokens and project env values with AES-256-GCM. The key comes from `CREDENTIAL_ENCRYPTION_KEY` (never in the DB), and `keyVersion` is stored per row.
**Rotation procedure (MVP):** add `CREDENTIAL_ENCRYPTION_KEY_PREVIOUS`, deploy, run the `secrets:reencrypt` script, then remove the old key.

### D-10 · 2026-11-20 · Accepted — Northflank integration uses verified endpoints only

**Decision:** Base `https://api.northflank.com/v1/`, Bearer token, 1000 req/h rate limit, cursor pagination. MVP endpoints: list projects, list services, list builds, start build (all verified in docs). Others (deployments, logs, restart) get verified before use. Retry only GET requests. Respect `x-ratelimit-reset`.

### D-11 · 2026-11-20 · Accepted — Sessions in Postgres, hashed tokens; Argon2id passwords; admin via CLI bootstrap

**Why:** Simple and secure for one user. No setup web route to forget to disable.

### D-12 · 2026-11-20 · Accepted — One Postgres addon, one database + role per project

**Decision:** The single free Postgres addon hosts StackDock's DB plus `proj_<slug>` databases with their own roles. StackDock provisions them using the addon admin credentials and injects `DATABASE_URL` into each project.
**Why:** The owner wants an own DB per project on Northflank, but the free plan allows only 1 addon.
**Trade-offs:** Shared storage and CPU. Postgres only. Must verify the admin user can run `CREATE DATABASE`/`CREATE ROLE` (fallback: schema per project).

### D-13 · 2026-11-20 · Accepted — No GitHub writes by Claude without explicit permission

**Decision:** The owner creates the StackDock GitHub repo. Claude may use local git (init, commit when asked) but must not push, create repos, open PRs or change GitHub settings without explicit permission each time. Project repos are public, so StackDock needs no GitHub token.

### D-14 · 2026-11-20 · Accepted — Use the Northflank-provided domain for now

**Decision:** Serve on Northflank `*.code.run` domains (one per port, see D-15). Custom or wildcard domains come later.

### D-15 · 2026-11-20 · Accepted — One Northflank public port per project, so each project gets its own URL

**Decision:** Each project gets its own public HTTP port on StackDock's Northflank service. Northflank assigns each public port its own URL: `https://<port-name>--<service>--<random>.code.run`.

- StackDock itself uses port name `dash` → `https://dash--<service>--<random>.code.run`.
- For each project, StackDock opens a **listener** on an internal port (e.g. 10001, 10002…) that reverse-proxies to the project's private process on 127.0.0.1 (e.g. 20001). Projects never bind public interfaces directly, so StackDock can show a "project stopped / starting" page, log requests, and health-check.
- Adding or removing a port: StackDock calls `PATCH /v1/projects/{projectId}/services/combined/{serviceId}` with the **full** `ports` array (read the current service first, then write). Requires a Northflank API token with _Project > Services > General > Update_ on StackDock's own service.
- Path routing `/apps/<slug>` on the `dash` URL stays as a **fallback**, so a project works even before its port exists.
- Routing mode is configurable: `ROUTING_MODE=northflank-ports | path | host`. The laptop (Phase 8) uses `host` (custom domain/subdomains) or `path`.

**Constraints (from the official API schema):**

- Port name = **project URL name**: 1–8 characters, pattern `^[a-zA-Z](-?[a-zA-Z0-9]+(-[a-zA-Z0-9]+)*)?$` (starts with a letter, letters/digits/single hyphens). The project slug is validated against this.
- The random part of the URL can't be chosen.
- Every port change **redeploys the StackDock service**, so all projects restart (restored from DB per D-05). Port changes are confirmed in the UI and logged.

**Unverified (check before Phase 7):** the max number of ports on the free plan; whether PATCH replaces or merges the `ports` array (we always send the full array, which is safe either way); which env vars Northflank injects for the service's own project/service IDs (otherwise set `NF_PROJECT_ID`/`NF_SERVICE_ID` manually).

### D-16 · 2026-11-20 · Accepted — Phase 1 toolchain versions

**Decision:** Node.js **24 LTS** (instead of 22 from the spec: 24 is the current Active LTS and is what's installed locally), pnpm 12, Turborepo 2, TypeScript **6.0** (not 7.x: the NestJS 12 CLI peers on `~6.0`), NestJS 12 (ESM only), Next.js 16 static export, Tailwind 4, shadcn/ui (base-nova), Prisma **7.10** with `@prisma/adapter-pg` (Prisma 8 is still a release candidate), Zod 4, Vitest 4, oxlint.
**Notes:**

- pnpm's `minimumReleaseAge` supply-chain policy is kept on. Packages published in the last 24h are not installed.
- Prisma `migrate dev` doesn't generate the client in v7. `pnpm build` runs `prisma generate`.
- Local Postgres listens on host port **5433** (5432 was taken by another container on the dev machine).

### D-17 · 2026-11-20 · Accepted — API and UI served from one origin in production

**Decision:** NestJS serves `apps/web/out` itself (clean URLs like `/projects` → `projects.html`, path-traversal safe, 404 page for unknown paths), with all API routes under `/api/v1`. Dev uses two servers (Next dev :3000, API :4000) with CORS restricted to `WEB_URL` in development only.
**CSP:** Helmet defaults plus `script-src 'self' 'unsafe-inline'`, because Next's static export uses inline bootstrap scripts. To tighten with hashes in Phase 7.

### D-18 · 2026-11-20 · Accepted — Authentication details (Phase 2)

- **Hashing:** `@node-rs/argon2` (prebuilt native binary, no build scripts), Argon2id with m=19 MiB, t=2, p=1 (OWASP minimum, chosen for the ~512 MB host). Node's built-in `crypto.argon2` is still a release candidate.
- **Session token:** 32 random bytes, base64url. The DB stores `HMAC-SHA256(SESSION_SECRET, token)`, so a DB leak alone can't produce valid cookies. Lifetime 7 days, idle timeout 24h (both configurable). `lastSeenAt` is written at most every 5 minutes.
- **Cookie:** `HttpOnly; SameSite=Lax; Path=/`, plus `Secure` and the `__Host-` prefix in production.
- **Guards (global, in order):** Throttler → CSRF → Auth. Routes are private by default, and `@Public()` opts out.
- **CSRF:** custom header `X-Requested-With: stackdock` on non-GET requests, plus an Origin check (own host, or `WEB_URL` in development only). Chosen over CSRF tokens because the UI and API share an origin and the header forces a CORS preflight.
- **Rate limiting:** `@nestjs/throttler` in memory (one process, so that's enough). Login 5/min + 20/h per IP. **Requires `TRUST_PROXY=1` on Northflank**, otherwise every client shares the proxy's IP.
- **No user enumeration:** one error message, and a dummy hash verify for unknown emails.
- **Session fixation:** a new token on every login, and any presented old token is revoked.
- **Admin bootstrap:** CLI only (`admin:create` refuses when an admin exists; `admin:reset-password` revokes all sessions). Non-interactive via env vars for one-off jobs.
- **UI gating** happens client-side (static export). The real protection is the API guard. Protected pages' HTML contains no data.
- **Tests:** API integration tests run against a real Postgres database (`stackdock_test`), and Playwright browser tests run against the production build using the locally installed Chrome (`PLAYWRIGHT_CHANNEL` to override).

### D-19 · 2026-11-20 · Accepted — Phase 3: encryption format, provider connection, error contract

- **Ciphertext format:** `v<keyVersion>.<iv>.<tag>.<data>` (base64url). AES-256-GCM with a 96-bit random IV and a 128-bit tag. **AAD = record context** (`provider:NORTHFLANK`, later `envvar:<projectId>:<KEY>`), so swapping ciphertexts between rows fails. Rotation follows D-09 with `CREDENTIAL_KEY_VERSION`, `CREDENTIAL_ENCRYPTION_KEY_PREVIOUS` and the `secrets:reencrypt` CLI.
- **Token verification:** `GET /v1/auth` ("Get current authentication info", **no permissions required**, verified in the official docs). It returns the token name, team/org, role and expiry, which we store as non-secret `accountInfo`. A token is stored **only after** Northflank accepts it.
- **Team tokens only (for now):** org-scoped tokens need a `/v1/teams/{teamId}/…` prefix on every call. These are rejected with `NF_ORG_TOKEN_UNSUPPORTED` until needed.
- **Test connection never throws for provider errors.** It records `status=ERROR` plus a safe `lastErrorCode`, and the UI shows a mapped message.
- **Error contract:** `AppError(status, code, message, details?)`. The code and message are explicitly user-safe, so the exception filter passes them through even for 5xx. Northflank errors map to `NF_*` codes and HTTP 400/403/404/409/429/502/504, with `details.retryAfterSeconds` for rate limits.
- **Client:** fixed paths only (no SSRF), `redirect: 'error'`, 10 s timeout, up to 3 attempts for GET on network/5xx/timeout (exponential backoff), and automatic retry on 429 only when the reset is ≤ 5 s.
- **Testing:** unit tests mock `fetch`, API integration tests use a local fake Northflank HTTP server (`NORTHFLANK_API_URL`), and Playwright runs against a fake server process. Every test asserts that tokens never appear in responses, the DB or the activity log.
- **Activity API:** `GET /activity?limit&cursor`, newest first, cursor-paginated.

### D-20 · 2026-11-20 · Accepted — Phase 4: project registry

- **Identifier:** the immutable `slug` (1–8 chars, D-15) is used in URLs and API paths (`/api/v1/projects/:slug`). The UI uses query params (`/projects/view?slug=`) because static export has no dynamic routes.
- **Ports:** each project gets a `publicPort` from 10001–10999 (lowest free, unique in the DB, retried on a race) at creation. It's kept while archived and freed on permanent delete.
- **Validation (shared Zod, same in UI and API):** public `https://github.com/owner/repo` only (normalised, rejects credentials/other hosts/subpaths), git-ref-safe branch names, `rootDir` confined to the repo (no `..` or absolute paths), single-line commands ≤ 500 chars, health path starting with `/`. **Update schema has no defaults**, so a PATCH only changes the fields sent (a test caught this).
- **Lifecycle:** Archive (reversible, sets `desiredState=STOPPED`, blocks edits) → Delete permanently (archived only, typed-name confirmation, cascades env vars). Nothing here calls GitHub or Northflank.
- **Env vars:** `PUT /projects/:slug/env/:KEY` (upsert, returns `replaced`), `DELETE …`, `GET …/env` returns names and timestamps only. AES-256-GCM with AAD `envvar:<projectId>:<KEY>`, included in `secrets:reencrypt`. Reserved: `PORT`, `BASE_PATH`, `HOST`, `NODE_OPTIONS`, `STACKDOCK_*`. Max 32 KB, multi-line allowed. The UI asks for confirmation before replacing or deleting.
- **Deferred:** linking a project to an external Northflank service. In this architecture projects run inside StackDock, so this comes with Phase 6 if still useful.
- **Browser tests** give each test its own `X-Forwarded-For` (server `TRUST_PROXY=1`), so the real 5/min login limit isn't weakened for tests.

import { mkdtempSync, rmSync } from 'node:fs';
import { request as httpRequest } from 'node:http';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { NestExpressApplication } from '@nestjs/platform-express';
import type { PrismaClient } from '@stackdock/db';
import pg from 'pg';
import request from 'supertest';
import { RunnerService } from '../src/modules/runner/runner.service.js';
import { FixtureRepo, nodeApp } from './support/fixture-repo.js';
import { TEST_DATABASE_URL } from './support/global-setup.js';
import {
  createTestApp,
  createTestPrisma,
  CSRF,
  nextClientIp,
  resetDatabase,
  signInAsAdmin,
  waitFor,
} from './support/test-app.js';

const TERMINAL = ['LIVE', 'FAILED', 'CANCELLED', 'STOPPED', 'SUPERSEDED'];
const SIM_ADMIN = 'nf_admin_sim';
const SIM_PASSWORD = 'sim-admin-password-123';

/** Superuser connection for setup/cleanup only. */
async function asSuperuser(sql: string[], database?: string) {
  const url = new URL(TEST_DATABASE_URL);
  if (database) url.pathname = `/${database}`;
  const c = new pg.Client({ connectionString: url.toString() });
  await c.connect();
  try {
    for (const s of sql) await c.query(s);
  } finally {
    await c.end();
  }
}

async function dropProjectDatabases() {
  const c = new pg.Client({ connectionString: TEST_DATABASE_URL });
  await c.connect();
  const dbs = await c.query(
    "SELECT datname FROM pg_database WHERE datname LIKE 'proj\\_%'",
  );
  for (const { datname } of dbs.rows)
    await c.query(`DROP DATABASE IF EXISTS "${datname}" WITH (FORCE)`);
  const roles = await c.query(
    "SELECT rolname FROM pg_roles WHERE rolname LIKE 'proj\\_%'",
  );
  for (const { rolname } of roles.rows)
    await c.query(`DROP ROLE IF EXISTS "${rolname}"`);
  await c.end();
}

function urlWith(user: string, password: string, db: string): string {
  const u = new URL(TEST_DATABASE_URL);
  u.username = user;
  u.password = password;
  u.pathname = `/${db}`;
  return u.toString();
}

async function canConnect(url: string): Promise<boolean> {
  const c = new pg.Client({
    connectionString: url,
    connectionTimeoutMillis: 5_000,
  });
  try {
    await c.connect();
    await c.end();
    return true;
  } catch {
    return false;
  }
}

describe('Runner extras (integration)', () => {
  let app: NestExpressApplication;
  let prisma: PrismaClient;
  let cookie: string;
  let ip: string;
  let dataDir: string;
  const repos: FixtureRepo[] = [];

  const api = (
    method: 'get' | 'post' | 'put' | 'delete',
    p: string,
    body?: object,
  ) => {
    const req = request(app.getHttpServer())
      [method](`/api/v1${p}`)
      .set('Cookie', cookie)
      .set('X-Forwarded-For', ip)
      .set(CSRF);
    return body ? req.send(body) : req;
  };

  async function deployAndWait(slug: string) {
    const res = await api('post', `/projects/${slug}/deploy`).expect(202);
    const d = await waitFor(async () => {
      const x = (await api('get', `/deployments/${res.body.data.id}`)).body
        .data;
      return TERMINAL.includes(x.status) ? x : null;
    }, 120_000);
    if (d.status !== 'LIVE')
      throw new Error(`${d.status}: ${d.errorSummary}\n${d.log}`);
    return d;
  }

  async function startApp(overrides: Record<string, string> = {}) {
    app = await createTestApp({
      DATA_DIR: dataDir,
      RUNNER_ALLOW_LOCAL_REPOS: 'true',
      RUNNER_AUTOSTART: 'false',
      START_TIMEOUT_SECONDS: '20',
      PROJECT_DB_ADMIN_URL: urlWith(SIM_ADMIN, SIM_PASSWORD, 'stackdock_test'),
      ROUTING_MODE: 'path',
      ...overrides,
    });
  }

  beforeAll(async () => {
    dataDir = mkdtempSync(path.join(tmpdir(), 'stackdock-extra-'));
    prisma = createTestPrisma();
    await dropProjectDatabases();
    // Simulates Northflank's addon admin: can create DBs and roles, NOT superuser.
    await asSuperuser([
      `DROP ROLE IF EXISTS ${SIM_ADMIN}`,
      `CREATE ROLE ${SIM_ADMIN} LOGIN PASSWORD '${SIM_PASSWORD}' CREATEDB CREATEROLE NOSUPERUSER`,
    ]);
  }, 60_000);

  beforeEach(async () => {
    ip = nextClientIp();
    await resetDatabase(prisma);
  });

  afterEach(async () => {
    if (app) {
      const runner = app.get(RunnerService);
      for (const p of await prisma.project.findMany())
        await runner.teardown(p.slug, false);
      await app.close();
    }
    await dropProjectDatabases();
  });

  afterAll(async () => {
    await asSuperuser([`DROP ROLE IF EXISTS ${SIM_ADMIN}`]).catch(
      () => undefined,
    );
    await prisma.$disconnect();
    for (const r of repos) r.remove();
    rmSync(dataDir, { recursive: true, force: true });
  });

  const repo = () => {
    const r = new FixtureRepo(nodeApp('v1'));
    repos.push(r);
    return r;
  };

  describe('per-project databases (non-superuser admin, like Northflank)', () => {
    it('creates an isolated database, injects DATABASE_URL, and drops it', async () => {
      await startApp();
      cookie = await signInAsAdmin(app, prisma);
      const a = await prisma.project.create({
        data: {
          slug: 'alpha',
          name: 'a',
          repoUrl: repo().url,
          branch: 'main',
          publicPort: 10_001,
        },
      });
      await prisma.project.create({
        data: {
          slug: 'beta',
          name: 'b',
          repoUrl: repo().url,
          branch: 'main',
          publicPort: 10_002,
        },
      });

      const created = await api('post', '/projects/alpha/database').expect(201);
      expect(created.body.data).toMatchObject({
        exists: true,
        dbName: 'proj_alpha',
        roleName: 'proj_alpha_user',
        overriddenByEnv: false,
      });
      expect(JSON.stringify(created.body)).not.toMatch(/password/i);
      await api('post', '/projects/alpha/database').expect(409);
      await api('post', '/projects/beta/database').expect(201);

      // Read alpha's credentials the way the runner does.
      const { ProjectDatabaseService } =
        await import('../src/modules/runner/project-database.service.js');
      const alphaUrl = (await app
        .get(ProjectDatabaseService)
        .connectionUrl(a.id))!;
      const alpha = new URL(alphaUrl);

      // alpha can use its own database…
      const own = new pg.Client({ connectionString: alphaUrl });
      await own.connect();
      await own.query('CREATE TABLE notes (id serial primary key, body text)');
      await own.query("INSERT INTO notes (body) VALUES ('hi')");
      expect(
        (await own.query('SELECT count(*)::int AS n FROM notes')).rows[0].n,
      ).toBe(1);
      await own.end();

      // …but not beta's database…
      expect(
        await canConnect(
          urlWith(
            alpha.username,
            decodeURIComponent(alpha.password),
            'proj_beta',
          ),
        ),
      ).toBe(false);

      // …and cannot read StackDock's own tables.
      const main = new pg.Client({
        connectionString: urlWith(
          alpha.username,
          decodeURIComponent(alpha.password),
          'stackdock_test',
        ),
      });
      if (
        await main.connect().then(
          () => true,
          () => false,
        )
      ) {
        await expect(main.query('SELECT * FROM "AdminUser"')).rejects.toThrow(
          /permission denied/,
        );
        await expect(
          main.query('SELECT * FROM "ProviderConnection"'),
        ).rejects.toThrow(/permission denied/);
        await main.end();
      }

      // The app receives DATABASE_URL at runtime.
      await deployAndWait('alpha');
      const res = await request(app.getHttpServer())
        .get('/apps/alpha/')
        .expect(200);
      expect(res.body.hasDatabaseUrl).toBe(true);

      // Project can't be deleted while it has a database.
      await api('post', '/projects/alpha/archive').expect(200);
      const blocked = await api('delete', '/projects/alpha', {
        confirmSlug: 'alpha',
      }).expect(409);
      expect(blocked.body.error.code).toBe('PROJECT_HAS_DATABASE');

      // Dropping requires the typed name.
      await api('delete', '/projects/alpha/database', {
        confirmSlug: 'nope',
      }).expect(400);
      const dropped = await api('delete', '/projects/alpha/database', {
        confirmSlug: 'alpha',
      }).expect(200);
      expect(dropped.body.data.exists).toBe(false);
      expect(await canConnect(alphaUrl)).toBe(false);

      const logs = await prisma.activityLog.findMany({
        where: { action: { startsWith: 'project.db_' } },
      });
      expect(logs.map((l) => l.action).sort()).toEqual([
        'project.db_created',
        'project.db_created',
        'project.db_deleted',
      ]);
      expect(JSON.stringify(logs)).not.toContain(
        decodeURIComponent(alpha.password),
      );
    }, 180_000);

    it('reports a clear error when the admin connection is not allowed to create databases', async () => {
      await asSuperuser([
        'DROP ROLE IF EXISTS weak_admin_sim',
        "CREATE ROLE weak_admin_sim LOGIN PASSWORD 'weak-password-123' NOSUPERUSER NOCREATEDB NOCREATEROLE",
      ]);
      await startApp({
        PROJECT_DB_ADMIN_URL: urlWith(
          'weak_admin_sim',
          'weak-password-123',
          'stackdock_test',
        ),
      });
      cookie = await signInAsAdmin(app, prisma);
      await prisma.project.create({
        data: {
          slug: 'weak',
          name: 'w',
          repoUrl: repo().url,
          branch: 'main',
          publicPort: 10_003,
        },
      });
      const res = await api('post', '/projects/weak/database').expect(403);
      expect(res.body.error.code).toBe('DATABASE_PERMISSION_DENIED');
      expect(await prisma.projectDatabase.count()).toBe(0);
      await app.close();
      app = undefined as never;
      await asSuperuser(['DROP ROLE IF EXISTS weak_admin_sim']);
    }, 60_000);
  });

  it('restores running projects after a StackDock restart without rebuilding', async () => {
    await startApp();
    cookie = await signInAsAdmin(app, prisma);
    await prisma.project.create({
      data: {
        slug: 'boot',
        name: 'boot',
        repoUrl: repo().url,
        branch: 'main',
        publicPort: 10_004,
      },
    });
    await deployAndWait('boot');
    const deploymentsBefore = await prisma.deployment.count();
    await app.close(); // stops all project processes

    await startApp({ RUNNER_AUTOSTART: 'true' });
    await waitFor(
      async () =>
        (await request(app.getHttpServer()).get('/apps/boot/')).status === 200,
      30_000,
      'boot restore',
    );
    expect(await prisma.deployment.count()).toBe(deploymentsBefore);
    const project = await prisma.project.findUniqueOrThrow({
      where: { slug: 'boot' },
    });
    expect(project.status).toBe('RUNNING');
  }, 120_000);

  it('rebuilds on boot when the build folder is gone (e.g. wiped disk)', async () => {
    await startApp();
    cookie = await signInAsAdmin(app, prisma);
    await prisma.project.create({
      data: {
        slug: 'wiped',
        name: 'w',
        repoUrl: repo().url,
        branch: 'main',
        publicPort: 10_005,
      },
    });
    await deployAndWait('wiped');
    await app.close();
    rmSync(path.join(dataDir, 'projects', 'wiped'), {
      recursive: true,
      force: true,
    });

    await startApp({ RUNNER_AUTOSTART: 'true' });
    await waitFor(
      async () =>
        (await request(app.getHttpServer()).get('/apps/wiped/')).status === 200,
      90_000,
      'rebuild on boot',
    );
    const boots = await prisma.deployment.findMany({
      where: { trigger: 'BOOT' },
    });
    expect(boots).toHaveLength(1);
  }, 150_000);

  it('northflank-ports mode: the project answers on its own public port', async () => {
    await startApp({ ROUTING_MODE: 'northflank-ports' });
    cookie = await signInAsAdmin(app, prisma);
    await prisma.project.create({
      data: {
        slug: 'ported',
        name: 'p',
        repoUrl: repo().url,
        branch: 'main',
        publicPort: 10_777,
      },
    });
    await deployAndWait('ported');

    const get = (p: string) =>
      new Promise<{ status: number; body: string }>((resolve, reject) => {
        const req = httpRequest(
          { host: '127.0.0.1', port: 10_777, path: p },
          (res) => {
            let body = '';
            res.on('data', (c) => (body += c));
            res.on('end', () => resolve({ status: res.statusCode ?? 0, body }));
          },
        );
        req.on('error', reject);
        req.end();
      });

    const res = await waitFor(async () => {
      const r = await get('/hello');
      return r.status === 200 ? r : null;
    }, 10_000);
    expect(JSON.parse(res.body)).toMatchObject({
      version: 'v1',
      path: '/hello',
    });

    await api('post', '/projects/ported/stop').expect(200);
    expect((await get('/')).status).toBe(503);
  }, 120_000);
});

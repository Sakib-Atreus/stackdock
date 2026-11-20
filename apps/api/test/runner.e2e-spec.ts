import { execSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { NestExpressApplication } from '@nestjs/platform-express';
import type { PrismaClient } from '@stackdock/db';
import request from 'supertest';
import { RunnerService } from '../src/modules/runner/runner.service.js';
import {
  FixtureRepo,
  goApp,
  nodeApp,
  phpApp,
  pythonApp,
} from './support/fixture-repo.js';
import {
  createTestApp,
  createTestPrisma,
  CSRF,
  nextClientIp,
  resetDatabase,
  signInAsAdmin,
  waitFor,
} from './support/test-app.js';

const has = (cmd: string) => {
  try {
    execSync(`command -v ${cmd}`, { stdio: 'pipe' });
    return true;
  } catch {
    return false;
  }
};
const SECRET = 'super-secret-token-value-123';
const TERMINAL = ['LIVE', 'FAILED', 'CANCELLED', 'STOPPED', 'SUPERSEDED'];

describe('Runner (integration: real builds and processes)', () => {
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

  async function createProject(
    slug: string,
    repo: FixtureRepo,
    extra: object = {},
  ) {
    const port = 10_001 + (await prisma.project.count());
    return prisma.project.create({
      data: {
        slug,
        name: slug,
        repoUrl: repo.url,
        branch: 'main',
        publicPort: port,
        healthCheckPath: null,
        ...extra,
      },
    });
  }

  async function deployAndWait(slug: string, expected = 'LIVE') {
    const res = await api('post', `/projects/${slug}/deploy`).expect(202);
    const id = res.body.data.id as string;
    const done = await waitFor(
      async () => {
        const d = (await api('get', `/deployments/${id}`)).body.data;
        return TERMINAL.includes(d.status) ? d : null;
      },
      120_000,
      `deployment ${slug}`,
    );
    if (done.status !== expected) {
      throw new Error(
        `Expected ${expected}, got ${done.status}: ${done.errorSummary}\n${done.log}`,
      );
    }
    return done;
  }

  const appGet = (p: string) => request(app.getHttpServer()).get(p);

  beforeAll(async () => {
    dataDir = mkdtempSync(path.join(tmpdir(), 'stackdock-data-'));
    prisma = createTestPrisma();
    await resetDatabase(prisma);
    app = await createTestApp({
      DATA_DIR: dataDir,
      RUNNER_ALLOW_LOCAL_REPOS: 'true',
      RUNNER_AUTOSTART: 'false',
      START_TIMEOUT_SECONDS: '20',
    });
  }, 60_000);

  beforeEach(async () => {
    ip = nextClientIp();
    await resetDatabase(prisma);
    cookie = await signInAsAdmin(app, prisma);
  });

  afterEach(async () => {
    const runner = app.get(RunnerService);
    for (const p of await prisma.project.findMany())
      await runner.teardown(p.slug, true);
  });

  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
    for (const r of repos) r.remove();
    rmSync(dataDir, { recursive: true, force: true });
  });

  const repo = (files: Record<string, string>) => {
    const r = new FixtureRepo(files);
    repos.push(r);
    return r;
  };

  it('clones, installs, builds, starts and routes a Node app', async () => {
    const r = repo(nodeApp('v1'));
    const project = await createProject('nodeapp', r);
    await api('put', '/projects/nodeapp/env/API_KEY', {
      value: 'public-key',
    }).expect(200);

    const d = await deployAndWait('nodeapp');
    expect(d).toMatchObject({ runtime: 'NODE', commitMessage: 'initial' });
    expect(d.commitSha).toMatch(/^[0-9a-f]{40}$/);
    expect(d.log).toContain('$ npm install');
    expect(d.log).toContain('build ok');

    const res = await appGet('/apps/nodeapp/some/path?q=1').expect(200);
    expect(res.body).toMatchObject({
      version: 'v1',
      built: 'built v1',
      path: '/some/path?q=1', // prefix stripped
      hasSessionSecret: false,
      hasEncryptionKey: false,
      apiKey: 'public-key',
      basePath: '/apps/nodeapp',
      nodeEnv: 'production',
    });

    const status = await prisma.project.findUniqueOrThrow({
      where: { id: project.id },
    });
    expect(status).toMatchObject({
      status: 'RUNNING',
      desiredState: 'RUNNING',
    });
    expect(status.lastCommitSha).toBe(d.commitSha);

    // /apps/nodeapp → /apps/nodeapp/
    const redirect = await appGet('/apps/nodeapp?x=1').expect(308);
    expect(redirect.headers.location).toBe('/apps/nodeapp/?x=1');
  }, 120_000);

  it('strips the StackDock session cookie in both directions', async () => {
    const r = repo(nodeApp('v1'));
    await createProject('cookies', r);
    await deployAndWait('cookies');

    const echo = await appGet('/apps/cookies/echo')
      .set('Cookie', `sd_session=${'a'.repeat(43)}; theme=dark`)
      .expect(200);
    expect(echo.body.cookie).toBe('theme=dark');
    expect(echo.body['x-forwarded-prefix']).toBe('/apps/cookies');

    const set = await appGet('/apps/cookies/setcookie').expect(200);
    const cookies = (set.headers['set-cookie'] as unknown as string[]) ?? [];
    expect(cookies.some((c) => c.startsWith('sd_session='))).toBe(false);
    expect(cookies.some((c) => c.startsWith('app_cookie='))).toBe(true);
  }, 120_000);

  it('redacts secret env values from build and runtime logs', async () => {
    const r = repo({
      ...nodeApp('v1'),
      'build.js': "console.log('build sees ' + process.env.SECRET_TOKEN)",
    });
    await createProject('secrets', r);
    await api('put', '/projects/secrets/env/SECRET_TOKEN', {
      value: SECRET,
    }).expect(200);
    const d = await deployAndWait('secrets');
    expect(d.log).toContain('build sees ••••');
    expect(d.log).not.toContain(SECRET);

    const logs = await waitFor(async () => {
      const page = (await api('get', '/projects/secrets/logs')).body.data;
      return page.lines.some((l: { text: string }) =>
        l.text.includes('starting with token'),
      )
        ? page
        : null;
    });
    const text = JSON.stringify(logs);
    expect(text).toContain('starting with token ••••');
    expect(text).not.toContain(SECRET);
  }, 120_000);

  it('blue/green: a new version replaces the old; a failed deploy keeps the old one serving', async () => {
    const r = repo(nodeApp('v1'));
    await createProject('bluegrn', r);
    await deployAndWait('bluegrn');
    expect((await appGet('/apps/bluegrn/')).body.version).toBe('v1');

    r.commit(nodeApp('v2'), 'v2');
    const d2 = await deployAndWait('bluegrn');
    expect((await appGet('/apps/bluegrn/')).body.version).toBe('v2');
    const all = (await api('get', '/projects/bluegrn/deployments')).body.data;
    expect(all.map((x: { status: string }) => x.status)).toEqual([
      'LIVE',
      'SUPERSEDED',
    ]);

    r.commit({ 'build.js': 'process.exit(3)' }, 'broken build');
    const failed = await deployAndWait('bluegrn', 'FAILED');
    expect(failed.errorSummary).toMatch(/exit code 3/);
    expect((await appGet('/apps/bluegrn/')).body.version).toBe('v2');
    const project = await prisma.project.findUniqueOrThrow({
      where: { slug: 'bluegrn' },
    });
    expect(project).toMatchObject({
      status: 'RUNNING',
      lastCommitSha: d2.commitSha,
    });
  }, 180_000);

  it('fails clearly when the app never opens its port', async () => {
    const r = repo({
      'package.json': JSON.stringify({ scripts: { start: 'node idle.js' } }),
      'idle.js': 'setInterval(() => {}, 1000)',
    });
    await createProject('noport', r);
    const d = await deployAndWait('noport', 'FAILED');
    expect(d.errorSummary).toMatch(/did not open port/);
    expect(
      (await prisma.project.findUniqueOrThrow({ where: { slug: 'noport' } }))
        .status,
    ).toBe('FAILED');
    await appGet('/apps/noport/').expect(503);
  }, 120_000);

  it('uses the health check path when set', async () => {
    const r = repo(nodeApp('v1'));
    await createProject('health', r, { healthCheckPath: '/health' });
    await deployAndWait('health');
    await appGet('/apps/health/health').expect(200);
  }, 120_000);

  it('restarts a crashed app automatically', async () => {
    const r = repo(nodeApp('v1'));
    await createProject('crashy', r);
    await deployAndWait('crashy');
    await appGet('/apps/crashy/crash').expect(200);
    await waitFor(
      async () => (await appGet('/apps/crashy/')).status === 503,
      5_000,
      'crash',
    );
    await waitFor(
      async () => (await appGet('/apps/crashy/')).status === 200,
      20_000,
      'restart',
    );
    const logs = (await api('get', '/projects/crashy/logs')).body.data;
    expect(JSON.stringify(logs)).toContain('Restarting in');
    expect(
      (await prisma.project.findUniqueOrThrow({ where: { slug: 'crashy' } }))
        .status,
    ).toBe('RUNNING');
  }, 120_000);

  it('stop, restart (no rebuild) and the not-running page', async () => {
    const r = repo(nodeApp('v1'));
    await createProject('stopper', r);
    await deployAndWait('stopper');

    await api('post', '/projects/stopper/stop').expect(200);
    const page = await appGet('/apps/stopper/').expect(503);
    expect(page.text).toContain('not running');
    expect(
      (await prisma.project.findUniqueOrThrow({ where: { slug: 'stopper' } }))
        .status,
    ).toBe('STOPPED');

    const before = await prisma.deployment.count();
    await api('post', '/projects/stopper/restart').expect(200);
    expect((await appGet('/apps/stopper/')).body.version).toBe('v1');
    expect(await prisma.deployment.count()).toBe(before);
  }, 120_000);

  it('rejects a second deploy while one is in progress, and can cancel', async () => {
    const r = repo({
      ...nodeApp('v1'),
      'build.js': 'setTimeout(() => {}, 30000)',
    });
    await createProject('slow', r);
    const first = await api('post', '/projects/slow/deploy').expect(202);
    const second = await api('post', '/projects/slow/deploy').expect(409);
    expect(second.body.error.code).toBe('DEPLOY_IN_PROGRESS');

    await waitFor(async () =>
      ['BUILDING'].includes(
        (await api('get', `/deployments/${first.body.data.id}`)).body.data
          .status,
      ),
    );
    await api('post', `/deployments/${first.body.data.id}/cancel`).expect(200);
    const d = await waitFor(async () => {
      const x = (await api('get', `/deployments/${first.body.data.id}`)).body
        .data;
      return TERMINAL.includes(x.status) ? x : null;
    });
    expect(d.status).toBe('CANCELLED');
  }, 120_000);

  it('archiving stops the app; deleting removes its files', async () => {
    const r = repo(nodeApp('v1'));
    await createProject('archy', r);
    await deployAndWait('archy');
    await api('post', '/projects/archy/archive').expect(200);
    await appGet('/apps/archy/').expect(503);
    await api('delete', '/projects/archy', { confirmSlug: 'archy' }).expect(
      200,
    );
    expect(execSync(`ls ${dataDir}/projects`).toString()).not.toContain(
      'archy',
    );
  }, 120_000);

  it('rejects a repository the runner is not allowed to clone', async () => {
    await prisma.project.create({
      data: {
        slug: 'evil',
        name: 'evil',
        repoUrl: 'https://gitlab.com/x/y',
        branch: 'main',
        publicPort: 10_050,
      },
    });
    const d = await deployAndWait('evil', 'FAILED');
    expect(d.errorSummary).toMatch(/not an allowed/);
  }, 60_000);

  it('builds and runs a Python app', async () => {
    const r = repo(pythonApp);
    await createProject('pyapp', r);
    const d = await deployAndWait('pyapp');
    expect(d.runtime).toBe('PYTHON');
    expect((await appGet('/apps/pyapp/x').expect(200)).body).toEqual({
      lang: 'python',
      path: '/x',
    });
  }, 180_000);

  it.skipIf(!has('go'))(
    'builds and runs a Go app',
    async () => {
      const r = repo(goApp);
      await createProject('goapp', r);
      const d = await deployAndWait('goapp');
      expect(d.runtime).toBe('GO');
      expect((await appGet('/apps/goapp/x').expect(200)).body).toEqual({
        lang: 'go',
        path: '/x',
      });
    },
    300_000,
  );

  it.skipIf(!has('php'))(
    'runs a PHP app',
    async () => {
      const r = repo(phpApp);
      await createProject('phpapp', r);
      const d = await deployAndWait('phpapp');
      expect(d.runtime).toBe('PHP');
      expect((await appGet('/apps/phpapp/x').expect(200)).body).toEqual({
        lang: 'php',
        path: '/x',
      });
    },
    180_000,
  );
});

import type { NestExpressApplication } from '@nestjs/platform-express';
import type { PrismaClient } from '@stackdock/db';
import request from 'supertest';
import { MockNorthflank, NF_TOKENS } from './support/mock-northflank.js';
import {
  createTestApp,
  createTestPrisma,
  CSRF,
  nextClientIp,
  resetDatabase,
  signInAsAdmin,
} from './support/test-app.js';

describe('Northflank integration (against a fake Northflank API)', () => {
  const mock = new MockNorthflank();
  let app: NestExpressApplication;
  let prisma: PrismaClient;
  let cookie: string;
  let ip: string;
  let mockUrl: string;

  const api = (
    method: 'get' | 'post' | 'delete',
    path: string,
    body?: object,
  ) => {
    const req = request(app.getHttpServer())
      [method](`/api/v1${path}`)
      .set('Cookie', cookie)
      .set('X-Forwarded-For', ip)
      .set(CSRF);
    return body ? req.send(body) : req;
  };

  async function boot(env: Record<string, string>) {
    app = await createTestApp({
      NORTHFLANK_API_URL: mockUrl,
      RUNNER_AUTOSTART: 'false',
      ...env,
    });
    cookie = await signInAsAdmin(app, prisma);
  }
  const connect = () =>
    api('post', '/providers/northflank/connect', {
      token: NF_TOKENS.valid,
    }).expect(200);
  const addProject = (slug: string, publicPort: number) =>
    prisma.project.create({
      data: {
        slug,
        name: slug,
        repoUrl: `https://github.com/me/${slug}`,
        branch: 'main',
        publicPort,
      },
    });

  beforeAll(async () => {
    mockUrl = await mock.start();
    prisma = createTestPrisma();
  });
  beforeEach(async () => {
    ip = nextClientIp();
    await resetDatabase(prisma);
    mock.selfPorts = [
      {
        name: 'dash',
        internalPort: 8080,
        public: true,
        protocol: 'HTTP',
        security: { sso: { enabled: false } },
      },
    ];
    mock.requests = [];
  });
  afterEach(async () => {
    await app?.close();
  });
  afterAll(async () => {
    await prisma.$disconnect();
    await mock.stop();
  });

  it('requires a connection, then lists projects (all pages), services and builds', async () => {
    await boot({});
    const missing = await api('get', '/northflank/projects').expect(409);
    expect(missing.body.error.code).toBe('PROVIDER_NOT_CONNECTED');

    await connect();
    const projects = await api('get', '/northflank/projects').expect(200);
    expect(projects.body.data.map((p: { id: string }) => p.id)).toEqual([
      'stackdock-proj',
      'second',
    ]);

    const services = await api(
      'get',
      '/northflank/projects/stackdock-proj/services',
    ).expect(200);
    expect(services.body.data[0]).toMatchObject({
      id: 'stackdock',
      type: 'combined',
      buildStatus: 'SUCCESS',
      deploymentStatus: 'COMPLETED',
    });

    const detail = await api(
      'get',
      '/northflank/projects/stackdock-proj/services/stackdock',
    ).expect(200);
    expect(detail.body.data).toMatchObject({ canBuild: true, branch: 'main' });
    expect(detail.body.data.builds[0]).toMatchObject({
      id: 'build-1',
      success: true,
    });
  });

  it('caches reads for a short time, and refresh=true bypasses it', async () => {
    await boot({});
    await connect();
    await api('get', '/northflank/projects/stackdock-proj/services').expect(
      200,
    );
    await api('get', '/northflank/projects/stackdock-proj/services').expect(
      200,
    );
    const count = () =>
      mock.requests.filter((r) =>
        r.path.startsWith('/v1/projects/stackdock-proj/services'),
      ).length;
    expect(count()).toBe(1);
    await api(
      'get',
      '/northflank/projects/stackdock-proj/services?refresh=true',
    ).expect(200);
    expect(count()).toBe(2);
  });

  it('rejects invalid IDs before calling Northflank', async () => {
    await boot({});
    await connect();
    const before = mock.requests.length;
    await api('get', '/northflank/projects/..%2Fauth/services').expect(400);
    await api('get', '/northflank/projects/UPPER/services').expect(400);
    expect(mock.requests.length).toBe(before);
  });

  it('starts a build with a branch and audits it', async () => {
    await boot({});
    await connect();
    const res = await api(
      'post',
      '/northflank/projects/stackdock-proj/services/stackdock/build',
      {
        branch: 'release/1.2',
      },
    ).expect(202);
    expect(res.body.data).toMatchObject({
      branch: 'release/1.2',
      status: 'QUEUED',
    });
    expect(mock.requests.at(-1)).toMatchObject({
      method: 'POST',
      body: { branch: 'release/1.2' },
    });
    const log = await prisma.activityLog.findFirst({
      where: { action: 'northflank.build_started' },
    });
    expect(log?.status).toBe('SUCCESS');
    await api(
      'post',
      '/northflank/projects/stackdock-proj/services/stackdock/build',
      {
        branch: '--evil',
      },
    ).expect(400);
  });

  describe("StackDock's own service and per-project URLs", () => {
    const ON_NF = {
      NF_PROJECT_ID: 'stackdock-proj',
      NF_OBJECT_ID: 'stackdock',
      NF_HOSTS: 'dash--stackdock--stackdock-proj--abc1.code.run',
      ROUTING_MODE: 'northflank-ports',
    };

    it('explains when StackDock is not on Northflank', async () => {
      await boot({});
      await connect();
      const self = await api('get', '/northflank/self').expect(200);
      expect(self.body.data).toMatchObject({
        onNorthflank: false,
        problem: expect.stringContaining('not running on Northflank'),
      });
      await addProject('shop', 10_001);
      const res = await api('post', '/projects/shop/expose').expect(409);
      expect(res.body.error.code).toBe('WRONG_ROUTING_MODE');
    });

    it('adds a port named after the project, keeping existing ports intact', async () => {
      await boot(ON_NF);
      await connect();
      await addProject('shop', 10_001);

      const self = await api('get', '/northflank/self').expect(200);
      expect(self.body.data).toMatchObject({
        onNorthflank: true,
        serviceType: 'combined',
        problem: null,
        ports: [
          {
            name: 'dash',
            internalPort: 8080,
            public: true,
            url: 'https://dash--stackdock--stackdock-proj--abc1.code.run/',
          },
        ],
      });

      const res = await api('post', '/projects/shop/expose').expect(200);
      expect(res.body.data).toEqual({ restarting: true, portName: 'shop' });
      const patch = mock.requests.find((r) => r.method === 'PATCH');
      expect(patch?.body).toEqual({
        ports: [
          {
            name: 'dash',
            internalPort: 8080,
            public: true,
            protocol: 'HTTP',
            security: { sso: { enabled: false } },
          },
          {
            name: 'shop',
            internalPort: 10_001,
            public: true,
            protocol: 'HTTP',
          },
        ],
      });
      const project = await api('get', '/projects/shop').expect(200);
      expect(project.body.data).toMatchObject({ exposed: true, ownUrl: null });

      // Exposing again is a no-op (no second PATCH).
      const again = await api('post', '/projects/shop/expose').expect(200);
      expect(again.body.data.restarting).toBe(false);
      expect(mock.requests.filter((r) => r.method === 'PATCH')).toHaveLength(1);

      // Can't permanently delete while exposed.
      await api('post', '/projects/shop/archive').expect(200);
      const del = await api('delete', '/projects/shop', {
        confirmSlug: 'shop',
      }).expect(409);
      expect(del.body.error.code).toBe('PROJECT_EXPOSED');
    });

    it('shows the code.run URL once Northflank injected it (after the restart)', async () => {
      await boot({
        ...ON_NF,
        NF_HOSTS:
          'dash--stackdock--stackdock-proj--abc1.code.run,shop--stackdock--stackdock-proj--abc1.code.run',
      });
      await connect();
      await addProject('shop', 10_001);
      await prisma.project.update({
        where: { slug: 'shop' },
        data: { exposedAt: new Date() },
      });
      const project = await api('get', '/projects/shop').expect(200);
      expect(project.body.data.ownUrl).toBe(
        'https://shop--stackdock--stackdock-proj--abc1.code.run/',
      );
    });

    it('refuses clashing port names or numbers', async () => {
      mock.selfPorts.push({
        name: 'shop',
        internalPort: 9999,
        public: true,
        protocol: 'HTTP',
      });
      await boot(ON_NF);
      await connect();
      await addProject('shop', 10_001);
      const res = await api('post', '/projects/shop/expose').expect(409);
      expect(res.body.error.code).toBe('PORT_NAME_TAKEN');
      expect(mock.requests.filter((r) => r.method === 'PATCH')).toHaveLength(0);
    });

    it('removes only that project port', async () => {
      mock.selfPorts.push({
        name: 'shop',
        internalPort: 10_001,
        public: true,
        protocol: 'HTTP',
      });
      mock.selfPorts.push({
        name: 'blog',
        internalPort: 10_002,
        public: true,
        protocol: 'HTTP',
      });
      await boot(ON_NF);
      await connect();
      await addProject('shop', 10_001);
      await prisma.project.update({
        where: { slug: 'shop' },
        data: { exposedAt: new Date() },
      });

      const res = await api('delete', '/projects/shop/expose').expect(200);
      expect(res.body.data.restarting).toBe(true);
      const patch = mock.requests.find((r) => r.method === 'PATCH');
      expect(patch).toBeDefined();
      const body = patch!.body as { ports: Array<{ name: string }> };
      expect(body.ports.map((p) => p.name)).toEqual(['dash', 'blog']);
      expect((await api('get', '/projects/shop')).body.data.exposed).toBe(
        false,
      );
      const logs = await prisma.activityLog.findMany({
        where: { action: 'project.unexposed' },
      });
      expect(logs).toHaveLength(1);
    });

    it('opens a listener on every project port at boot (northflank-ports mode)', async () => {
      await addProject('shop', 10_811);
      await boot(ON_NF);
      const { request: httpRequest } = await import('node:http');
      const status = await new Promise<number>((resolve, reject) => {
        const r = httpRequest(
          { host: '127.0.0.1', port: 10_811, path: '/' },
          (res) => {
            res.resume();
            resolve(res.statusCode ?? 0);
          },
        );
        r.on('error', reject);
        r.end();
      });
      expect(status).toBe(503); // "not running" page instead of connection refused
    });
  });
});

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

describe('Northflank provider connection (integration)', () => {
  const mock = new MockNorthflank();
  let app: NestExpressApplication;
  let prisma: PrismaClient;
  let cookie: string;
  let ip: string;
  /** Every response body seen, to prove tokens never leak. */
  const seen: string[] = [];

  const call = async (
    method: 'get' | 'post' | 'delete',
    path: string,
    body?: object,
    expectStatus?: number,
  ) => {
    let req = request(app.getHttpServer())
      [method](`/api/v1${path}`)
      .set('Cookie', cookie)
      .set('X-Forwarded-For', ip)
      .set(CSRF);
    if (body) req = req.send(body);
    const res = await req;
    seen.push(JSON.stringify(res.body), JSON.stringify(res.headers));
    if (expectStatus !== undefined) expect(res.status).toBe(expectStatus);
    return res;
  };

  beforeAll(async () => {
    const url = await mock.start();
    prisma = createTestPrisma();
    app = await createTestApp({ NORTHFLANK_API_URL: url });
  });

  beforeEach(async () => {
    ip = nextClientIp();
    await resetDatabase(prisma);
    mock.accepted.add(NF_TOKENS.valid);
    mock.outage = false;
    cookie = await signInAsAdmin(app, prisma);
  });

  afterAll(async () => {
    for (const token of Object.values(NF_TOKENS)) {
      expect(seen.join('\n')).not.toContain(token);
    }
    await app.close();
    await prisma.$disconnect();
    await mock.stop();
  });

  it('requires a session', async () => {
    await request(app.getHttpServer())
      .post('/api/v1/providers/northflank/connect')
      .set(CSRF)
      .send({ token: NF_TOKENS.valid })
      .expect(401);
  });

  it('starts disconnected', async () => {
    const res = await call('get', '/providers', undefined, 200);
    expect(res.body.data[0]).toMatchObject({
      provider: 'NORTHFLANK',
      connected: false,
      tokenHint: null,
    });
  });

  it('connects a valid token: verifies it, encrypts it, never returns it', async () => {
    const res = await call(
      'post',
      '/providers/northflank/connect',
      {
        token: NF_TOKENS.valid,
      },
      200,
    );

    expect(res.body.data).toMatchObject({
      connected: true,
      status: 'CONNECTED',
      tokenHint: NF_TOKENS.valid.slice(-4),
      account: {
        tokenName: 'StackDock',
        entityId: 'my-team',
        roleName: 'Developer',
      },
    });

    const row = await prisma.providerConnection.findUniqueOrThrow({
      where: { provider: 'NORTHFLANK' },
    });
    expect(row.encryptedCredential.startsWith('v1.')).toBe(true);
    expect(row.encryptedCredential).not.toContain(NF_TOKENS.valid);
    expect(JSON.stringify(row)).not.toContain(NF_TOKENS.valid);

    const logs = await prisma.activityLog.findMany({
      where: { action: 'provider.connected' },
    });
    expect(logs).toHaveLength(1);
    expect(JSON.stringify(logs)).not.toContain(NF_TOKENS.valid);
  });

  it('rejects an invalid token and stores nothing', async () => {
    const res = await call(
      'post',
      '/providers/northflank/connect',
      {
        token: NF_TOKENS.revoked,
      },
      400,
    );
    expect(res.body.error.code).toBe('NF_UNAUTHORIZED');
    expect(await prisma.providerConnection.count()).toBe(0);
  });

  it('rejects organisation-scoped tokens with a clear message', async () => {
    const res = await call(
      'post',
      '/providers/northflank/connect',
      {
        token: NF_TOKENS.org,
      },
      400,
    );
    expect(res.body.error.code).toBe('NF_ORG_TOKEN_UNSUPPORTED');
    expect(await prisma.providerConnection.count()).toBe(0);
  });

  it('validates the token format before calling Northflank', async () => {
    const before = mock.requests.length;
    const res = await call(
      'post',
      '/providers/northflank/connect',
      {
        token: 'short',
      },
      400,
    );
    expect(res.body.error.fields.token).toBeDefined();
    expect(mock.requests.length).toBe(before);
  });

  it('reports a provider outage with a safe message', async () => {
    mock.outage = true;
    const res = await call(
      'post',
      '/providers/northflank/connect',
      {
        token: NF_TOKENS.valid,
      },
      502,
    );
    expect(res.body.error).toMatchObject({
      code: 'NF_UNAVAILABLE',
      message: expect.stringContaining('not responding'),
    });
  });

  it('replaces an existing token', async () => {
    await call('post', '/providers/northflank/connect', {
      token: NF_TOKENS.valid,
    });
    const res = await call(
      'post',
      '/providers/northflank/connect',
      {
        token: NF_TOKENS.replacement,
      },
      200,
    );
    expect(res.body.data.account.tokenName).toBe('StackDock 2');
    expect(await prisma.providerConnection.count()).toBe(1);
  });

  describe('test connection', () => {
    beforeEach(async () => {
      await call('post', '/providers/northflank/connect', {
        token: NF_TOKENS.valid,
      });
    });

    it('succeeds while the token is valid', async () => {
      const res = await call(
        'post',
        '/providers/northflank/test',
        undefined,
        200,
      );
      expect(res.body.data.status).toBe('CONNECTED');
      expect(res.body.data.lastTestedAt).toBeTruthy();
    });

    it('marks the connection as errored when the token is revoked', async () => {
      mock.accepted.delete(NF_TOKENS.valid);
      const res = await call(
        'post',
        '/providers/northflank/test',
        undefined,
        200,
      );
      expect(res.body.data).toMatchObject({
        status: 'ERROR',
        lastErrorCode: 'NF_UNAUTHORIZED',
        lastErrorMessage: expect.stringContaining('rejected the API token'),
      });
    });

    it('detects a credential that can no longer be decrypted', async () => {
      await prisma.providerConnection.updateMany({
        data: {
          encryptedCredential:
            'v1.AAAAAAAAAAAAAAAA.AAAAAAAAAAAAAAAAAAAAAA.AAAA',
        },
      });
      const res = await call(
        'post',
        '/providers/northflank/test',
        undefined,
        200,
      );
      expect(res.body.data.lastErrorCode).toBe('CREDENTIAL_UNREADABLE');
    });

    it('disconnects and removes the stored credential', async () => {
      await call('delete', '/providers/northflank', undefined, 200);
      expect(await prisma.providerConnection.count()).toBe(0);
      const res = await call(
        'post',
        '/providers/northflank/test',
        undefined,
        409,
      );
      expect(res.body.error.code).toBe('PROVIDER_NOT_CONNECTED');
    });
  });

  describe('activity log API', () => {
    it('lists newest first with cursor pagination', async () => {
      await call('post', '/providers/northflank/connect', {
        token: NF_TOKENS.valid,
      });
      await call('post', '/providers/northflank/test');
      await call('delete', '/providers/northflank');

      const first = await call('get', '/activity?limit=2', undefined, 200);
      expect(
        first.body.data.items.map((i: { action: string }) => i.action),
      ).toEqual(['provider.disconnected', 'provider.tested']);
      expect(first.body.data.nextCursor).toBeTruthy();

      const second = await call(
        'get',
        `/activity?limit=2&cursor=${first.body.data.nextCursor}`,
        undefined,
        200,
      );
      expect(second.body.data.items[0].action).toBe('provider.connected');
    });

    it('requires a session', async () => {
      await request(app.getHttpServer()).get('/api/v1/activity').expect(401);
    });
  });
});

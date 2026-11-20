import type { NestExpressApplication } from '@nestjs/platform-express';
import type { PrismaClient } from '@stackdock/db';
import request from 'supertest';
import { EncryptionService } from '../src/modules/crypto/encryption.service.js';
import { envVarContext } from '../src/modules/projects/projects.service.js';
import {
  createTestApp,
  createTestPrisma,
  CSRF,
  nextClientIp,
  resetDatabase,
  signInAsAdmin,
} from './support/test-app.js';

const SHOP = {
  slug: 'shop',
  name: 'Shop API',
  repoUrl: 'https://github.com/me/shop.git',
  branch: 'main',
  runtime: 'NODE',
};

describe('Projects (integration)', () => {
  let app: NestExpressApplication;
  let prisma: PrismaClient;
  let cookie: string;
  let ip: string;

  const api = (
    method: 'get' | 'post' | 'patch' | 'put' | 'delete',
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

  beforeAll(async () => {
    prisma = createTestPrisma();
    app = await createTestApp();
  });

  beforeEach(async () => {
    ip = nextClientIp();
    await resetDatabase(prisma);
    cookie = await signInAsAdmin(app, prisma);
  });

  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
  });

  it('requires a session', async () => {
    await request(app.getHttpServer()).get('/api/v1/projects').expect(401);
  });

  describe('create', () => {
    it('creates a project with normalised values and a port', async () => {
      const res = await api('post', '/projects', SHOP).expect(201);
      expect(res.body.data).toMatchObject({
        slug: 'shop',
        repoUrl: 'https://github.com/me/shop',
        rootDir: '.',
        runtime: 'NODE',
        status: 'NOT_DEPLOYED',
        desiredState: 'STOPPED',
        publicPort: 10001,
        envVarCount: 0,
        pathUrl: '/apps/shop/',
      });
      const log = await prisma.activityLog.findFirst({
        where: { action: 'project.created' },
      });
      expect(log?.safeMetadata).toMatchObject({ slug: 'shop' });
    });

    it('assigns the next free port', async () => {
      await api('post', '/projects', SHOP).expect(201);
      const res = await api('post', '/projects', {
        ...SHOP,
        slug: 'blog',
      }).expect(201);
      expect(res.body.data.publicPort).toBe(10002);
    });

    it('rejects a duplicate name', async () => {
      await api('post', '/projects', SHOP).expect(201);
      const res = await api('post', '/projects', SHOP).expect(409);
      expect(res.body.error.code).toBe('SLUG_TAKEN');
    });

    it('validates input with field errors', async () => {
      const res = await api('post', '/projects', {
        ...SHOP,
        slug: 'Not Valid',
        repoUrl: 'https://gitlab.com/x/y',
        rootDir: '../etc',
      }).expect(400);
      expect(Object.keys(res.body.error.fields)).toEqual(
        expect.arrayContaining(['slug', 'repoUrl', 'rootDir']),
      );
    });
  });

  describe('existing project', () => {
    beforeEach(async () => {
      await api('post', '/projects', SHOP).expect(201);
    });

    it('lists and gets', async () => {
      const list = await api('get', '/projects').expect(200);
      expect(list.body.data.map((p: { slug: string }) => p.slug)).toEqual([
        'shop',
      ]);
      await api('get', '/projects/shop').expect(200);
      const missing = await api('get', '/projects/nope').expect(404);
      expect(missing.body.error.code).toBe('PROJECT_NOT_FOUND');
    });

    it('updates only the fields sent and logs field names', async () => {
      const res = await api('patch', '/projects/shop', {
        name: 'Shop v2',
        startCommand: 'node dist/server.js',
      }).expect(200);
      expect(res.body.data).toMatchObject({
        name: 'Shop v2',
        startCommand: 'node dist/server.js',
        runtime: 'NODE',
        branch: 'main',
      });
      const log = await prisma.activityLog.findFirst({
        where: { action: 'project.updated' },
      });
      expect(log?.safeMetadata).toMatchObject({
        fields: expect.arrayContaining(['name', 'startCommand']),
      });
    });

    it('ignores attempts to change the slug', async () => {
      const res = await api('patch', '/projects/shop', {
        slug: 'other',
        name: 'Renamed',
      }).expect(200);
      expect(res.body.data.slug).toBe('shop');
    });

    it('archives (reversible), hides from the list, blocks edits, restores', async () => {
      const archived = await api('post', '/projects/shop/archive').expect(200);
      expect(archived.body.data.archivedAt).toBeTruthy();
      expect((await api('get', '/projects')).body.data).toHaveLength(0);
      expect(
        (await api('get', '/projects?archived=true')).body.data,
      ).toHaveLength(1);

      const edit = await api('patch', '/projects/shop', { name: 'x' }).expect(
        409,
      );
      expect(edit.body.error.code).toBe('PROJECT_ARCHIVED');

      await api('post', '/projects/shop/restore').expect(200);
      expect((await api('get', '/projects')).body.data).toHaveLength(1);
    });

    it('deletes permanently only when archived and confirmed', async () => {
      const notArchived = await api('delete', '/projects/shop', {
        confirmSlug: 'shop',
      }).expect(409);
      expect(notArchived.body.error.code).toBe('PROJECT_NOT_ARCHIVED');

      await api('post', '/projects/shop/archive').expect(200);
      const wrong = await api('delete', '/projects/shop', {
        confirmSlug: 'shopp',
      }).expect(400);
      expect(wrong.body.error.code).toBe('CONFIRMATION_MISMATCH');

      await api('delete', '/projects/shop', { confirmSlug: 'shop' }).expect(
        200,
      );
      expect(await prisma.project.count()).toBe(0);
      // The name (and port) are free again.
      const again = await api('post', '/projects', SHOP).expect(201);
      expect(again.body.data.publicPort).toBe(10001);
    });

    describe('environment variables', () => {
      const SECRET = 'sk_live_super_secret_value_123';

      it('stores values encrypted, never returns them, logs only the key', async () => {
        const set = await api('put', '/projects/shop/env/STRIPE_KEY', {
          value: SECRET,
        }).expect(200);
        expect(set.body.data).toEqual({ key: 'STRIPE_KEY', replaced: false });

        const list = await api('get', '/projects/shop/env').expect(200);
        expect(list.body.data).toEqual([
          expect.objectContaining({ key: 'STRIPE_KEY' }),
        ]);
        expect(JSON.stringify(list.body)).not.toContain(SECRET);

        const project = await api('get', '/projects/shop').expect(200);
        expect(project.body.data.envVarCount).toBe(1);
        expect(JSON.stringify(project.body)).not.toContain(SECRET);

        const row = await prisma.projectEnvVar.findFirstOrThrow();
        expect(row.encryptedValue).not.toContain(SECRET);
        const encryption = new EncryptionService({
          CREDENTIAL_ENCRYPTION_KEY: Buffer.alloc(32, 3).toString('base64'),
          CREDENTIAL_KEY_VERSION: 1,
        } as never);
        expect(
          encryption.decrypt(
            row.encryptedValue,
            envVarContext(row.projectId, 'STRIPE_KEY'),
          ),
        ).toBe(SECRET);

        const logs = await prisma.activityLog.findMany({
          where: { action: 'project.env_set' },
        });
        expect(JSON.stringify(logs)).toContain('STRIPE_KEY');
        expect(JSON.stringify(logs)).not.toContain(SECRET);
      });

      it('reports when a value is replaced', async () => {
        await api('put', '/projects/shop/env/A', { value: '1' }).expect(200);
        const res = await api('put', '/projects/shop/env/A', {
          value: '2',
        }).expect(200);
        expect(res.body.data.replaced).toBe(true);
        expect(await prisma.projectEnvVar.count()).toBe(1);
      });

      it('rejects reserved and invalid names', async () => {
        await api('put', '/projects/shop/env/PORT', { value: '1' }).expect(400);
        await api('put', '/projects/shop/env/STACKDOCK_X', {
          value: '1',
        }).expect(400);
        await api('put', '/projects/shop/env/1BAD', { value: '1' }).expect(400);
      });

      it('deletes a variable', async () => {
        await api('put', '/projects/shop/env/A', { value: '1' }).expect(200);
        await api('delete', '/projects/shop/env/A').expect(200);
        await api('delete', '/projects/shop/env/A').expect(404);
      });

      it('cannot change variables of an archived project', async () => {
        await api('post', '/projects/shop/archive').expect(200);
        await api('put', '/projects/shop/env/A', { value: '1' }).expect(409);
      });

      it('deleting a project deletes its variables', async () => {
        await api('put', '/projects/shop/env/A', { value: '1' }).expect(200);
        await api('post', '/projects/shop/archive').expect(200);
        await api('delete', '/projects/shop', { confirmSlug: 'shop' }).expect(
          200,
        );
        expect(await prisma.projectEnvVar.count()).toBe(0);
      });
    });
  });
});

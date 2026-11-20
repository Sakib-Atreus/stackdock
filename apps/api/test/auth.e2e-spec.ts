import type { NestExpressApplication } from '@nestjs/platform-express';
import type { PrismaClient } from '@stackdock/db';
import request from 'supertest';
import { PasswordService } from '../src/modules/auth/password.service.js';
import {
  createTestApp,
  createTestPrisma,
  nextClientIp,
  resetDatabase,
} from './support/test-app.js';

const EMAIL = 'admin@example.com';
const PASSWORD = 'correct horse battery staple';
const CSRF = { 'X-Requested-With': 'stackdock' };

function sessionCookie(res: request.Response): string {
  const raw = res.headers['set-cookie'] as unknown as string[] | undefined;
  const cookie = raw?.find((c) => c.startsWith('sd_session='));
  if (!cookie) throw new Error('no session cookie');
  return cookie.split(';')[0]!;
}

describe('Auth (integration)', () => {
  let app: NestExpressApplication;
  let prisma: PrismaClient;
  let http: ReturnType<typeof request>;
  let ip: string;

  const login = (body: object, headers: Record<string, string> = CSRF) =>
    http
      .post('/api/v1/auth/login')
      .set('X-Forwarded-For', ip)
      .set(headers)
      .send(body);

  beforeAll(async () => {
    prisma = createTestPrisma();
    app = await createTestApp();
    http = request(app.getHttpServer());
  });

  beforeEach(async () => {
    ip = nextClientIp();
    await resetDatabase(prisma);
    await prisma.adminUser.create({
      data: {
        email: EMAIL,
        passwordHash: await new PasswordService().hash(PASSWORD),
      },
    });
  });

  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
  });

  describe('route protection', () => {
    it('rejects protected routes without a session', async () => {
      const res = await http.get('/api/v1/auth/sessions').expect(401);
      expect(res.body.error.code).toBe('UNAUTHORIZED');
    });

    it('rejects a forged session cookie', async () => {
      await http
        .get('/api/v1/auth/sessions')
        .set('Cookie', `sd_session=${'a'.repeat(43)}`)
        .expect(401);
    });

    it('keeps the health check public', async () => {
      await http.get('/api/v1/health').expect(200);
    });

    it('reports a signed-out session without erroring', async () => {
      const res = await http.get('/api/v1/auth/session').expect(200);
      expect(res.body.data).toEqual({ user: null, expiresAt: null });
    });
  });

  describe('login', () => {
    it('signs in with a secure, HTTP-only cookie and stores only a hash', async () => {
      const res = await login({ email: EMAIL, password: PASSWORD }).expect(200);
      expect(res.body.data.user.email).toBe(EMAIL);
      expect(JSON.stringify(res.body)).not.toContain('passwordHash');

      const setCookie = (res.headers['set-cookie'] as unknown as string[])[0]!;
      expect(setCookie).toMatch(/HttpOnly/i);
      expect(setCookie).toMatch(/SameSite=Lax/i);
      expect(setCookie).toMatch(/Path=\//);

      const token = sessionCookie(res).split('=')[1]!;
      const stored = await prisma.session.findMany();
      expect(stored).toHaveLength(1);
      expect(stored[0]!.tokenHash).not.toBe(token);
      expect(stored[0]!.tokenHash).not.toContain(token);
    });

    it('accepts email in any case / with spaces', async () => {
      await login({ email: '  ADMIN@example.com ', password: PASSWORD }).expect(
        200,
      );
    });

    it('uses the same generic error for a wrong password and an unknown email', async () => {
      const wrong = await login({ email: EMAIL, password: 'nope' }).expect(401);
      const unknown = await login({
        email: 'who@example.com',
        password: PASSWORD,
      }).expect(401);
      expect(wrong.body.error.message).toBe('Invalid email or password.');
      expect(unknown.body.error).toEqual(wrong.body.error);
      expect(wrong.headers['set-cookie']).toBeUndefined();
    });

    it('records failures in the activity log without the password', async () => {
      await login({ email: EMAIL, password: 'a-secret-guess' }).expect(401);
      const logs = await prisma.activityLog.findMany();
      expect(logs).toHaveLength(1);
      expect(logs[0]).toMatchObject({
        action: 'auth.login',
        status: 'FAILURE',
      });
      expect(JSON.stringify(logs)).not.toContain('a-secret-guess');
    });

    it('validates input', async () => {
      const res = await login({ email: 'not-an-email' }).expect(400);
      expect(res.body.error.code).toBe('VALIDATION_FAILED');
      expect(Object.keys(res.body.error.fields)).toEqual(
        expect.arrayContaining(['email', 'password']),
      );
    });

    it('rejects requests without the CSRF header', async () => {
      const res = await login({ email: EMAIL, password: PASSWORD }, {}).expect(
        403,
      );
      expect(res.body.error.code).toBe('FORBIDDEN');
    });

    it('rejects cross-origin requests', async () => {
      await login(
        { email: EMAIL, password: PASSWORD },
        { ...CSRF, Origin: 'https://evil.example' },
      ).expect(403);
    });

    it('replaces an existing session on re-login (no fixation)', async () => {
      const first = sessionCookie(
        await login({ email: EMAIL, password: PASSWORD }),
      );
      const second = await http
        .post('/api/v1/auth/login')
        .set('X-Forwarded-For', ip)
        .set(CSRF)
        .set('Cookie', first)
        .send({ email: EMAIL, password: PASSWORD })
        .expect(200);
      expect(sessionCookie(second)).not.toBe(first);
      await http.get('/api/v1/auth/sessions').set('Cookie', first).expect(401);
      expect(await prisma.session.count()).toBe(1);
    });
  });

  describe('signed in', () => {
    let cookie: string;

    beforeEach(async () => {
      cookie = sessionCookie(await login({ email: EMAIL, password: PASSWORD }));
    });

    it('returns the current session', async () => {
      const res = await http
        .get('/api/v1/auth/session')
        .set('Cookie', cookie)
        .expect(200);
      expect(res.body.data.user.email).toBe(EMAIL);
    });

    it('logs out: deletes the session and clears the cookie', async () => {
      const res = await http
        .post('/api/v1/auth/logout')
        .set(CSRF)
        .set('Cookie', cookie)
        .expect(200);
      expect((res.headers['set-cookie'] as unknown as string[])[0]).toMatch(
        /sd_session=;/,
      );
      expect(await prisma.session.count()).toBe(0);
      await http.get('/api/v1/auth/sessions').set('Cookie', cookie).expect(401);
    });

    it('rejects an expired session', async () => {
      await prisma.session.updateMany({
        data: { expiresAt: new Date(Date.now() - 1000) },
      });
      await http.get('/api/v1/auth/sessions').set('Cookie', cookie).expect(401);
      expect(await prisma.session.count()).toBe(0);
    });

    it('rejects an idle session', async () => {
      await prisma.session.updateMany({
        data: { lastSeenAt: new Date(Date.now() - 25 * 3_600_000) },
      });
      await http.get('/api/v1/auth/sessions').set('Cookie', cookie).expect(401);
    });

    it('changes the password and signs out other sessions', async () => {
      const other = sessionCookie(
        await login({ email: EMAIL, password: PASSWORD }),
      );
      await http
        .post('/api/v1/auth/password')
        .set(CSRF)
        .set('Cookie', cookie)
        .send({
          currentPassword: PASSWORD,
          newPassword: 'a brand new password',
        })
        .expect(200);

      await http.get('/api/v1/auth/sessions').set('Cookie', cookie).expect(200);
      await http.get('/api/v1/auth/sessions').set('Cookie', other).expect(401);
      await login({ email: EMAIL, password: PASSWORD }).expect(401);
      await login({ email: EMAIL, password: 'a brand new password' }).expect(
        200,
      );
    });

    it('refuses a password change with the wrong current password', async () => {
      await http
        .post('/api/v1/auth/password')
        .set(CSRF)
        .set('Cookie', cookie)
        .send({ currentPassword: 'wrong', newPassword: 'a brand new password' })
        .expect(401);
    });

    it('lists sessions and revokes the others', async () => {
      await login({ email: EMAIL, password: PASSWORD });
      const list = await http
        .get('/api/v1/auth/sessions')
        .set('Cookie', cookie)
        .expect(200);
      expect(list.body.data).toHaveLength(2);
      expect(
        list.body.data.filter((s: { current: boolean }) => s.current),
      ).toHaveLength(1);
      expect(JSON.stringify(list.body)).not.toContain('tokenHash');

      const res = await http
        .delete('/api/v1/auth/sessions/others')
        .set(CSRF)
        .set('Cookie', cookie)
        .expect(200);
      expect(res.body.data.revoked).toBe(1);
    });
  });
});

describe('Auth rate limiting (integration)', () => {
  let app: NestExpressApplication;
  let prisma: PrismaClient;

  beforeAll(async () => {
    prisma = createTestPrisma();
    await resetDatabase(prisma);
    app = await createTestApp();
  });

  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
  });

  it('blocks the 6th login attempt within a minute, per client IP', async () => {
    const http = request(app.getHttpServer());
    const ip = nextClientIp();
    for (let i = 0; i < 5; i++) {
      await http
        .post('/api/v1/auth/login')
        .set('X-Forwarded-For', ip)
        .set(CSRF)
        .send({ email: EMAIL, password: 'guess' })
        .expect(401);
    }
    const res = await http
      .post('/api/v1/auth/login')
      .set('X-Forwarded-For', ip)
      .set(CSRF)
      .send({ email: EMAIL, password: PASSWORD })
      .expect(429);
    expect(res.body.error.code).toBe('RATE_LIMITED');

    // A different client is not affected.
    await http
      .post('/api/v1/auth/login')
      .set('X-Forwarded-For', nextClientIp())
      .set(CSRF)
      .send({ email: EMAIL, password: 'guess' })
      .expect(401);
  });
});

import type { NestExpressApplication } from '@nestjs/platform-express';
import { createPrismaClient, type PrismaClient } from '@stackdock/db';
import { TEST_DATABASE_URL } from './global-setup.js';

export const TEST_ENV = {
  NODE_ENV: 'test',
  DATABASE_URL: TEST_DATABASE_URL,
  SESSION_SECRET: 'test-session-secret-'.padEnd(40, 'x'),
  CREDENTIAL_ENCRYPTION_KEY: Buffer.alloc(32, 3).toString('base64'),
  APP_VERSION: 'test',
  WEB_DIST_DIR: '/nonexistent',
  // Behind one proxy, like Northflank: tests set X-Forwarded-For per client.
  TRUST_PROXY: '1',
};

let ipCounter = 0;
/** A fresh client IP, so each test gets its own rate-limit bucket. */
export function nextClientIp(): string {
  ipCounter += 1;
  return `203.0.113.${ipCounter % 250}`;
}

/** Builds the real app (same config as production) against the test DB. */
export async function createTestApp(
  overrides: Record<string, string> = {},
): Promise<NestExpressApplication> {
  Object.assign(process.env, TEST_ENV, overrides);
  const { createApp } = await import('../../src/create-app.js');
  const app = await createApp({ logger: false });
  await app.init();
  return app;
}

export function createTestPrisma(): PrismaClient {
  return createPrismaClient(TEST_DATABASE_URL);
}

export async function resetDatabase(prisma: PrismaClient): Promise<void> {
  await prisma.$executeRawUnsafe(
    'TRUNCATE "Session", "AdminUser", "ActivityLog", "ProviderConnection", "ProjectEnvVar", "Project" RESTART IDENTITY CASCADE',
  );
}

export const CSRF = { 'X-Requested-With': 'stackdock' };

/** Creates the admin and returns a session cookie for authenticated requests. */
export async function signInAsAdmin(
  app: NestExpressApplication,
  prisma: PrismaClient,
): Promise<string> {
  const { PasswordService } =
    await import('../../src/modules/auth/password.service.js');
  const password = 'integration test password';
  await prisma.adminUser.create({
    data: {
      email: 'admin@example.com',
      passwordHash: await new PasswordService().hash(password),
    },
  });
  const supertest = (await import('supertest')).default;
  const res = await supertest(app.getHttpServer())
    .post('/api/v1/auth/login')
    .set('X-Forwarded-For', nextClientIp())
    .set(CSRF)
    .send({ email: 'admin@example.com', password });
  const raw = res.headers['set-cookie'] as unknown as string[];
  return raw.find((c) => c.startsWith('sd_session='))!.split(';')[0]!;
}

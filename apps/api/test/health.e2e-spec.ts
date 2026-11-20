import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module.js';
import { ApiExceptionFilter } from '../src/common/filters/api-exception.filter.js';
import { API_PREFIX } from '../src/create-app.js';
import { PrismaService } from '../src/modules/prisma/prisma.service.js';
import { RunnerService } from '../src/modules/runner/runner.service.js';

const env = {
  DATABASE_URL: 'postgresql://u:p@localhost:5432/unused',
  SESSION_SECRET: 'x'.repeat(32),
  CREDENTIAL_ENCRYPTION_KEY: Buffer.alloc(32, 1).toString('base64'),
  APP_VERSION: 'test',
};

describe('GET /api/v1/health', () => {
  let app: INestApplication;
  const prisma = { isHealthy: vi.fn<() => Promise<boolean>>() };

  beforeAll(async () => {
    Object.assign(process.env, env);
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(PrismaService)
      .useValue(prisma)
      // The runner needs a real database; health doesn't.
      .overrideProvider(RunnerService)
      .useValue({ livePort: () => null })
      .compile();
    app = moduleRef.createNestApplication();
    app.setGlobalPrefix(API_PREFIX);
    app.useGlobalFilters(new ApiExceptionFilter());
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it('returns 200 ok when the database is up', async () => {
    prisma.isHealthy.mockResolvedValue(true);
    const res = await request(app.getHttpServer())
      .get('/api/v1/health')
      .expect(200);
    expect(res.body.data).toMatchObject({
      status: 'ok',
      version: 'test',
      checks: { database: 'up' },
    });
  });

  it('returns 503 degraded when the database is down', async () => {
    prisma.isHealthy.mockResolvedValue(false);
    const res = await request(app.getHttpServer())
      .get('/api/v1/health')
      .expect(503);
    expect(res.body.data.status).toBe('degraded');
  });

  it('returns the error envelope for unknown routes', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/v1/nope')
      .expect(404);
    expect(res.body.error.code).toBe('NOT_FOUND');
  });

  it('does not expose config values', async () => {
    prisma.isHealthy.mockResolvedValue(true);
    const res = await request(app.getHttpServer()).get('/api/v1/health');
    const text = JSON.stringify(res.body);
    expect(text).not.toContain(env.SESSION_SECRET);
    expect(text).not.toContain('postgresql://');
  });
});

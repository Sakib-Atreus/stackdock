import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Module } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import { serveStaticWeb } from '../src/static-web.js';

@Module({})
class EmptyModule {}

describe('serveStaticWeb', () => {
  let app: NestExpressApplication;
  let parent: string;

  beforeAll(async () => {
    parent = mkdtempSync(path.join(tmpdir(), 'stackdock-web-'));
    const out = path.join(parent, 'out');
    mkdirSync(path.join(out, 'projects'), { recursive: true });
    writeFileSync(path.join(out, 'index.html'), 'HOME');
    writeFileSync(path.join(out, 'projects.html'), 'PROJECTS');
    writeFileSync(path.join(out, '404.html'), 'MISSING');
    writeFileSync(path.join(parent, 'secret.html'), 'SECRET');

    app = await NestFactory.create<NestExpressApplication>(EmptyModule, {
      logger: false,
    });
    expect(serveStaticWeb(app, out)).toBe(true);
    await app.init();
  });

  afterAll(async () => {
    await app.close();
    rmSync(parent, { recursive: true, force: true });
  });

  it('serves the index page', async () => {
    const res = await request(app.getHttpServer()).get('/').expect(200);
    expect(res.text).toBe('HOME');
  });

  it.each(['/projects', '/projects/'])(
    'serves %s from projects.html without redirecting',
    async (url) => {
      const res = await request(app.getHttpServer()).get(url).expect(200);
      expect(res.text).toBe('PROJECTS');
    },
  );

  it('returns the 404 page for unknown paths', async () => {
    const res = await request(app.getHttpServer()).get('/nope').expect(404);
    expect(res.text).toBe('MISSING');
  });

  it('does not serve files outside the web directory', async () => {
    const res = await request(app.getHttpServer()).get('/%2e%2e/secret');
    expect(res.text).not.toBe('SECRET');
  });

  it('returns false when no build exists', async () => {
    const other = await NestFactory.create<NestExpressApplication>(
      EmptyModule,
      { logger: false },
    );
    expect(serveStaticWeb(other, path.join(parent, 'missing'))).toBe(false);
    await other.close();
  });
});

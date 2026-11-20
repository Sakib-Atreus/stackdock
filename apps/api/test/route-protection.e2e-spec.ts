import { RequestMethod } from '@nestjs/common';
import { METHOD_METADATA, PATH_METADATA } from '@nestjs/common/constants.js';
import {
  DiscoveryService,
  MetadataScanner,
  ModulesContainer,
  Reflector,
} from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import { IS_PUBLIC } from '../src/common/decorators/public.decorator.js';
import { createTestApp } from './support/test-app.js';

/** The ONLY routes allowed without a session. Adding one must be deliberate. */
const ALLOWED_PUBLIC = new Set([
  'GET /health',
  'POST /auth/login',
  'POST /auth/logout',
  'GET /auth/session',
]);

function join(...parts: string[]): string {
  return `/${parts
    .map((p) => p.replace(/^\/|\/$/g, ''))
    .filter(Boolean)
    .join('/')}`;
}

describe('Route protection (every API route)', () => {
  let app: NestExpressApplication;
  let routes: Array<{ route: string; isPublic: boolean }>;

  beforeAll(async () => {
    app = await createTestApp({ RUNNER_AUTOSTART: 'false' });
    const discovery = new DiscoveryService(app.get(ModulesContainer));
    const scanner = new MetadataScanner();
    const reflector = new Reflector();
    routes = [];
    for (const wrapper of discovery.getControllers()) {
      const { instance, metatype } = wrapper;
      if (!instance || !metatype) continue;
      const base =
        (Reflect.getMetadata(PATH_METADATA, metatype) as string) ?? '';
      const proto = Object.getPrototypeOf(instance) as object;
      for (const name of scanner.getAllMethodNames(proto)) {
        const handler = (proto as Record<string, unknown>)[name] as object;
        const path = Reflect.getMetadata(PATH_METADATA, handler) as
          string | undefined;
        if (path === undefined) continue;
        const method =
          RequestMethod[
            Reflect.getMetadata(METHOD_METADATA, handler) as number
          ];
        const isPublic = Boolean(
          reflector.getAllAndOverride<boolean>(IS_PUBLIC, [
            handler as never,
            metatype,
          ]),
        );
        routes.push({ route: `${method} ${join(base, path)}`, isPublic });
      }
    }
  });

  afterAll(async () => {
    await app.close();
  });

  it('finds the routes (sanity check)', () => {
    expect(routes.length).toBeGreaterThan(30);
  });

  it('only the allow-listed routes are public', () => {
    const publicRoutes = routes
      .filter((r) => r.isPublic)
      .map((r) => r.route)
      .sort();
    expect(publicRoutes).toEqual([...ALLOWED_PUBLIC].sort());
  });

  it('every private route really answers 401 without a session', async () => {
    const http = request(app.getHttpServer());
    for (const { route } of routes.filter((r) => !r.isPublic)) {
      const [method, path] = route.split(' ') as [string, string];
      const url = `/api/v1${path
        .replace(/:slug/g, 'shop')
        .replace(/:key/g, 'API_KEY')
        .replace(/:[a-zA-Z]+/g, 'abcdefghij12')}`;
      const res = await http[method.toLowerCase() as 'get'](url)
        .set('X-Requested-With', 'stackdock')
        .send({});
      expect({ route, status: res.status }).toEqual({ route, status: 401 });
    }
  });
});

import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';

export const NF_TOKENS = {
  valid: 'nf-valid-team-token-0123456789abcdef',
  replacement: 'nf-replacement-token-9876543210zzzz',
  org: 'nf-org-scoped-token-0123456789abcdef',
  revoked: 'nf-revoked-token-0123456789abcdefgh',
};

/**
 * A tiny fake of the Northflank API for integration tests. It never echoes
 * the token back.
 */
export class MockNorthflank {
  private server?: Server;
  /** Tokens currently accepted (lets tests "revoke" a token). */
  readonly accepted = new Set([
    NF_TOKENS.valid,
    NF_TOKENS.replacement,
    NF_TOKENS.org,
  ]);
  outage = false;
  requests: Array<{ method: string; path: string; body?: unknown }> = [];
  /** StackDock's own service ports (what PATCH replaces). */
  selfPorts: Array<Record<string, unknown>> = [
    {
      name: 'dash',
      internalPort: 8080,
      public: true,
      protocol: 'HTTP',
      security: { sso: { enabled: false } },
    },
  ];
  builds: Array<Record<string, unknown>> = [
    {
      id: 'build-1',
      branch: 'main',
      sha: 'a'.repeat(40),
      status: 'SUCCESS',
      concluded: true,
      success: true,
      createdAt: '2026-11-19T10:00:00.000Z',
    },
  ];

  async start(): Promise<string> {
    this.server = createServer((req, res) => {
      this.requests.push({ method: req.method ?? '', path: req.url ?? '' });
      const send = (status: number, body: unknown) => {
        res.writeHead(status, { 'content-type': 'application/json' });
        res.end(JSON.stringify(body));
      };
      if (this.outage) return send(503, { error: { message: 'down' } });

      const token = (req.headers.authorization ?? '').replace(/^Bearer /, '');
      if (!this.accepted.has(token)) {
        return send(401, { error: { status: 401, message: 'Unauthorized' } });
      }
      const url = new URL(req.url ?? '/', 'http://x');
      const path = url.pathname;
      if (req.method === 'GET' && path === '/v1/projects') {
        // Two pages, to exercise cursor pagination.
        return url.searchParams.get('cursor')
          ? send(200, {
              data: { projects: [{ id: 'second', name: 'Second' }] },
              pagination: { hasNextPage: false, count: 1 },
            })
          : send(200, {
              data: {
                projects: [
                  {
                    id: 'stackdock-proj',
                    name: 'StackDock project',
                    description: 'mine',
                  },
                ],
              },
              pagination: {
                hasNextPage: true,
                cursor: 'c'.repeat(24),
                count: 1,
              },
            });
      }
      if (
        req.method === 'GET' &&
        path === '/v1/projects/stackdock-proj/services'
      ) {
        return send(200, {
          data: {
            services: [
              {
                id: 'stackdock',
                name: 'StackDock',
                serviceType: 'combined',
                status: {
                  build: { status: 'SUCCESS' },
                  deployment: {
                    status: 'COMPLETED',
                    reason: 'DEPLOYING',
                    lastTransitionTime: '2026-11-20T10:00:00.000Z',
                  },
                },
              },
              {
                id: 'redis-ish',
                name: 'Image service',
                serviceType: 'deployment',
                status: {
                  deployment: { status: 'COMPLETED', reason: 'SCALING' },
                },
              },
            ],
          },
          pagination: { hasNextPage: false, count: 2 },
        });
      }
      if (
        req.method === 'GET' &&
        path === '/v1/projects/stackdock-proj/services/stackdock'
      ) {
        return send(200, {
          data: {
            id: 'stackdock',
            name: 'StackDock',
            serviceType: 'combined',
            ports: this.selfPorts,
            vcsData: {
              projectUrl: 'https://github.com/me/stackdock',
              projectBranch: 'main',
            },
            status: {
              build: { status: 'SUCCESS' },
              deployment: { status: 'COMPLETED', reason: 'DEPLOYING' },
            },
          },
        });
      }
      if (
        req.method === 'GET' &&
        path === '/v1/projects/stackdock-proj/services/stackdock/build'
      ) {
        return send(200, {
          data: { builds: this.builds },
          pagination: { hasNextPage: false, count: this.builds.length },
        });
      }
      const readBody = () =>
        new Promise<unknown>((resolve) => {
          let raw = '';
          req.on('data', (c) => (raw += c));
          req.on('end', () => resolve(raw ? JSON.parse(raw) : undefined));
        });
      if (
        req.method === 'POST' &&
        path === '/v1/projects/stackdock-proj/services/stackdock/build'
      ) {
        return void readBody().then((body) => {
          this.requests.at(-1)!.body = body;
          const b = {
            id: `build-${this.builds.length + 1}`,
            branch: (body as { branch?: string })?.branch ?? 'main',
            status: 'QUEUED',
            concluded: false,
          };
          this.builds.unshift(b);
          send(200, { data: b });
        });
      }
      if (
        req.method === 'PATCH' &&
        path === '/v1/projects/stackdock-proj/services/combined/stackdock'
      ) {
        return void readBody().then((body) => {
          this.requests.at(-1)!.body = body;
          this.selfPorts = (
            body as { ports: Array<Record<string, unknown>> }
          ).ports;
          send(200, { data: { id: 'stackdock' } });
        });
      }
      if (req.method === 'GET' && path === '/v1/auth') {
        const isOrg = token === NF_TOKENS.org;
        return send(200, {
          data: {
            tokenKind: 'api',
            id: 'stackdock',
            name: token === NF_TOKENS.replacement ? 'StackDock 2' : 'StackDock',
            entityId: isOrg ? 'my-org' : 'my-team',
            entityType: isOrg ? 'org' : 'team',
            role: { name: 'Developer', roleId: 'developer' },
            createdAt: '2026-11-01T00:00:00.000Z',
            expiresAt: null,
          },
        });
      }
      return send(404, { error: { message: 'not found' } });
    });
    await new Promise<void>((resolve) =>
      this.server!.listen(0, '127.0.0.1', resolve),
    );
    const { port } = this.server.address() as AddressInfo;
    return `http://127.0.0.1:${port}/v1/`;
  }

  async stop(): Promise<void> {
    await new Promise<void>((resolve) => this.server?.close(() => resolve()));
  }
}

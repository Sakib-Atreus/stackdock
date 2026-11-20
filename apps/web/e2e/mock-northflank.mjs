// Fake Northflank API for browser tests. Accepts only the token below.
import { createServer } from 'node:http';

const VALID = 'nf-e2e-valid-team-token-0123456789';
const port = Number(process.env.MOCK_NF_PORT ?? 4310);

let selfPorts = [
  { name: 'dash', internalPort: 4300, public: true, protocol: 'HTTP' },
];
const builds = [
  {
    id: 'b-1',
    branch: 'main',
    sha: 'a'.repeat(40),
    status: 'SUCCESS',
    concluded: true,
    success: true,
    createdAt: '2026-11-19T10:00:00.000Z',
  },
];

const readBody = (req) =>
  new Promise((resolve) => {
    let raw = '';
    req.on('data', (c) => (raw += c));
    req.on('end', () => resolve(raw ? JSON.parse(raw) : {}));
  });

createServer(async (req, res) => {
  const send = (status, body) => {
    res.writeHead(status, { 'content-type': 'application/json' });
    res.end(JSON.stringify(body));
  };
  const url = new URL(req.url ?? '/', 'http://x');
  const path = url.pathname;
  if (path === '/health') return send(200, { ok: true });
  if (path === '/__reset') {
    selfPorts = [
      { name: 'dash', internalPort: 4300, public: true, protocol: 'HTTP' },
    ];
    return send(200, {});
  }
  const token = (req.headers.authorization ?? '').replace(/^Bearer /, '');
  if (token !== VALID) return send(401, { error: { message: 'Unauthorized' } });

  if (req.method === 'GET' && path === '/v1/auth') {
    return send(200, {
      data: {
        tokenKind: 'api',
        id: 'stackdock',
        name: 'StackDock E2E',
        entityId: 'e2e-team',
        entityType: 'team',
        role: { name: 'StackDock', roleId: 'stackdock' },
        createdAt: '2026-11-01T00:00:00.000Z',
        expiresAt: null,
      },
    });
  }
  if (req.method === 'GET' && path === '/v1/projects') {
    return send(200, {
      data: { projects: [{ id: 'e2e-proj', name: 'E2E project' }] },
      pagination: { hasNextPage: false, count: 1 },
    });
  }
  if (req.method === 'GET' && path === '/v1/projects/e2e-proj/services') {
    return send(200, {
      data: {
        services: [
          {
            id: 'stackdock',
            name: 'StackDock',
            serviceType: 'combined',
            status: {
              build: { status: 'SUCCESS' },
              deployment: { status: 'COMPLETED' },
            },
          },
          {
            id: 'api',
            name: 'Image API',
            serviceType: 'deployment',
            status: { deployment: { status: 'COMPLETED' } },
          },
        ],
      },
      pagination: { hasNextPage: false, count: 2 },
    });
  }
  if (
    req.method === 'GET' &&
    path === '/v1/projects/e2e-proj/services/stackdock'
  ) {
    return send(200, {
      data: {
        id: 'stackdock',
        name: 'StackDock',
        serviceType: 'combined',
        ports: selfPorts,
        vcsData: {
          projectUrl: 'https://github.com/me/stackdock',
          projectBranch: 'main',
        },
        status: {
          build: { status: 'SUCCESS' },
          deployment: { status: 'COMPLETED' },
        },
      },
    });
  }
  if (req.method === 'GET' && path === '/v1/projects/e2e-proj/services/api') {
    return send(200, {
      data: {
        id: 'api',
        name: 'Image API',
        serviceType: 'deployment',
        status: {},
      },
    });
  }
  if (
    req.method === 'GET' &&
    path === '/v1/projects/e2e-proj/services/stackdock/build'
  ) {
    return send(200, {
      data: { builds },
      pagination: { hasNextPage: false, count: builds.length },
    });
  }
  if (
    req.method === 'POST' &&
    path === '/v1/projects/e2e-proj/services/stackdock/build'
  ) {
    const body = await readBody(req);
    // Concludes immediately so the UI doesn't keep polling.
    const b = {
      id: `b-${builds.length + 1}`,
      branch: body.branch ?? 'main',
      sha: 'b'.repeat(40),
      status: 'SUCCESS',
      concluded: true,
      success: true,
      createdAt: new Date().toISOString(),
    };
    builds.unshift(b);
    return send(200, { data: b });
  }
  if (
    req.method === 'PATCH' &&
    path === '/v1/projects/e2e-proj/services/combined/stackdock'
  ) {
    const body = await readBody(req);
    selfPorts = body.ports;
    return send(200, { data: { id: 'stackdock' } });
  }
  return send(404, {});
}).listen(port, '127.0.0.1');

// Fake Northflank API for browser tests. Accepts only the token below.
import { createServer } from 'node:http';

const VALID = 'nf-e2e-valid-team-token-0123456789';
const port = Number(process.env.MOCK_NF_PORT ?? 4310);

createServer((req, res) => {
  const send = (status, body) => {
    res.writeHead(status, { 'content-type': 'application/json' });
    res.end(JSON.stringify(body));
  };
  if (req.url === '/health') return send(200, { ok: true });
  const token = (req.headers.authorization ?? '').replace(/^Bearer /, '');
  if (token !== VALID) return send(401, { error: { message: 'Unauthorized' } });
  if (req.method === 'GET' && req.url === '/v1/auth') {
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
  return send(404, {});
}).listen(port, '127.0.0.1');

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
  requests: Array<{ method: string; path: string }> = [];

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
      if (req.method === 'GET' && req.url === '/v1/auth') {
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

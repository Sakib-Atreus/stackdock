import {
  createServer,
  type IncomingMessage,
  type Server,
  type ServerResponse,
} from 'node:http';
import type { Duplex } from 'node:stream';
import {
  Inject,
  Injectable,
  Logger,
  type OnApplicationBootstrap,
  type OnApplicationShutdown,
} from '@nestjs/common';
import { createProxyServer } from 'http-proxy-3';
import { ENV, type Env } from '../../config/env.js';
import { sessionCookieName } from '../auth/session-cookie.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { RunnerService } from './runner.service.js';

const PATH_PREFIX = /^\/apps\/([a-z][a-z0-9-]{0,7})(\/.*)?$/;

/**
 * Routes traffic to running projects:
 *  - path mode: https://<stackdock>/apps/<slug>/… (prefix stripped)
 *  - per-port listeners (ROUTING_MODE=northflank-ports): each project's
 *    public port proxies to its live process (D-15).
 * StackDock's session cookie is removed from proxied requests, and projects
 * can't set it, so project code never sees or replaces the admin session.
 */
@Injectable()
export class ProxyService
  implements OnApplicationBootstrap, OnApplicationShutdown
{
  private readonly logger = new Logger(ProxyService.name);
  private readonly proxy = createProxyServer({
    xfwd: true,
    ws: true,
    proxyTimeout: 120_000,
  });
  private readonly listeners = new Map<
    string,
    { server: Server; port: number }
  >();
  private readonly cookieName: string;

  constructor(
    private readonly runner: RunnerService,
    private readonly prisma: PrismaService,
    @Inject(ENV) private readonly env: Env,
  ) {
    this.cookieName = sessionCookieName(env);
    this.proxy.on('proxyReq', (proxyReq) => {
      const cookie = proxyReq.getHeader('cookie');
      if (typeof cookie === 'string') {
        const kept = cookie
          .split(';')
          .map((c) => c.trim())
          .filter((c) => c && !c.startsWith(`${this.cookieName}=`));
        if (kept.length) proxyReq.setHeader('cookie', kept.join('; '));
        else proxyReq.removeHeader('cookie');
      }
    });
    this.proxy.on('proxyRes', (proxyRes) => {
      const setCookie = proxyRes.headers['set-cookie'];
      if (setCookie) {
        proxyRes.headers['set-cookie'] = setCookie.filter(
          (c) => !c.trim().startsWith(`${this.cookieName}=`),
        );
      }
    });
    this.proxy.on('error', (_err, _req, res) => {
      if (res && 'writeHead' in res && !res.headersSent) {
        unavailable(res, 'The app did not respond.', 502);
      } else if (res && 'destroy' in res) {
        res.destroy();
      }
    });
    if (env.ROUTING_MODE === 'northflank-ports') {
      // Open a project's public listener as soon as it has a live process;
      // keep it open after a stop so visitors see the "not running" page.
      runner.onLiveChange = (slug) => {
        const publicPort = runner.supervisor.livePublicPort(slug);
        if (publicPort)
          void this.ensureListener(slug, publicPort).catch(() => undefined);
      };
      runner.onTeardown = (slug) => this.closeListener(slug);
    }
  }

  /** Express middleware for /apps/<slug>/… (registered before everything else). */
  readonly pathMiddleware = (
    req: IncomingMessage,
    res: ServerResponse,
    next: () => void,
  ) => {
    const match = PATH_PREFIX.exec((req.url ?? '').split('?')[0]!);
    if (!match) return next();
    const slug = match[1]!;
    if (match[2] === undefined) {
      // /apps/shop → /apps/shop/ so relative URLs resolve.
      const query = req.url!.includes('?')
        ? req.url!.slice(req.url!.indexOf('?'))
        : '';
      res.writeHead(308, { location: `/apps/${slug}/${query}` });
      return res.end();
    }
    const port = this.runner.livePort(slug);
    if (!port) return unavailable(res, 'This project is not running.');
    req.url = req.url!.slice(`/apps/${slug}`.length) || '/';
    req.headers['x-forwarded-prefix'] = `/apps/${slug}`;
    this.proxy.web(req, res, { target: `http://127.0.0.1:${port}` });
  };

  /** WebSocket upgrades for /apps/<slug>/… */
  handleUpgrade(req: IncomingMessage, socket: Duplex, head: Buffer): boolean {
    const match = PATH_PREFIX.exec((req.url ?? '').split('?')[0]!);
    if (!match) return false;
    const port = this.runner.livePort(match[1]!);
    if (!port) {
      socket.destroy();
      return true;
    }
    req.url = req.url!.slice(`/apps/${match[1]}`.length) || '/';
    this.proxy.ws(req, socket, head, { target: `ws://127.0.0.1:${port}` });
    return true;
  }

  /** Opens (or keeps) a public listener for a project (northflank-ports mode). */
  async ensureListener(slug: string, publicPort: number): Promise<void> {
    const existing = this.listeners.get(slug);
    if (existing?.port === publicPort) return;
    if (existing) await this.closeListener(slug);
    const server = createServer((req, res) => {
      const port = this.runner.livePort(slug);
      if (!port) return unavailable(res, 'This project is not running.');
      this.proxy.web(req, res, { target: `http://127.0.0.1:${port}` });
    });
    server.on('upgrade', (req, socket, head) => {
      const port = this.runner.livePort(slug);
      if (!port) return socket.destroy();
      this.proxy.ws(req, socket, head, { target: `ws://127.0.0.1:${port}` });
    });
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject);
      server.listen(publicPort, '0.0.0.0', () => resolve());
    }).catch((error: Error) => {
      this.logger.warn(
        `Could not open port ${publicPort} for ${slug}: ${error.message}`,
      );
      throw error;
    });
    this.listeners.set(slug, { server, port: publicPort });
  }

  async closeListener(slug: string): Promise<void> {
    const entry = this.listeners.get(slug);
    if (!entry) return;
    this.listeners.delete(slug);
    entry.server.closeAllConnections();
    await new Promise<void>((resolve) => entry.server.close(() => resolve()));
  }

  /**
   * northflank-ports mode: listen on every active project's port from the
   * start, so its own URL shows the "not running" page instead of a
   * Northflank error while it builds.
   */
  async onApplicationBootstrap(): Promise<void> {
    if (this.env.ROUTING_MODE !== 'northflank-ports') return;
    const projects = await this.prisma.client.project.findMany({
      where: { archivedAt: null },
      select: { slug: true, publicPort: true },
    });
    for (const p of projects) {
      await this.ensureListener(p.slug, p.publicPort).catch(() => undefined);
    }
  }

  async onApplicationShutdown(): Promise<void> {
    await Promise.all(
      [...this.listeners.keys()].map((s) => this.closeListener(s)),
    );
    this.proxy.close();
  }
}

function unavailable(res: ServerResponse, message: string, status = 503): void {
  if (res.headersSent) return void res.end();
  res.writeHead(status, {
    'content-type': 'text/html; charset=utf-8',
    'cache-control': 'no-store',
    'retry-after': '5',
  });
  res.end(`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Not available</title>
<style>body{font:16px system-ui,sans-serif;display:grid;place-items:center;min-height:100vh;margin:0;background:#fafafa;color:#222}main{text-align:center;padding:24px}p{color:#666}@media(prefers-color-scheme:dark){body{background:#111;color:#eee}p{color:#aaa}}</style></head>
<body><main><h1>${status === 503 ? 'Not running' : 'Unavailable'}</h1><p>${message}</p><p>If it was just deployed, try again in a few seconds.</p></main></body></html>`);
}

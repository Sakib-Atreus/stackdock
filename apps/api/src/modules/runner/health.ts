import { request } from 'node:http';
import { createConnection, createServer } from 'node:net';

/** True if something accepts TCP connections on 127.0.0.1:port. */
export function tcpOpen(port: number, timeoutMs = 1_000): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = createConnection({ host: '127.0.0.1', port });
    const done = (ok: boolean) => {
      socket.destroy();
      resolve(ok);
    };
    socket.setTimeout(timeoutMs, () => done(false));
    socket.once('connect', () => done(true));
    socket.once('error', () => done(false));
  });
}

/** True for any HTTP response below 500 (redirects and 404s still mean "up"). */
export function httpOk(
  port: number,
  pathName: string,
  timeoutMs = 2_000,
): Promise<boolean> {
  return new Promise((resolve) => {
    const req = request(
      {
        host: '127.0.0.1',
        port,
        path: pathName,
        method: 'GET',
        timeout: timeoutMs,
      },
      (res) => {
        res.resume();
        resolve((res.statusCode ?? 500) < 400);
      },
    );
    req.on('timeout', () => req.destroy());
    req.on('error', () => resolve(false));
    req.end();
  });
}

/** Whether we can bind 127.0.0.1:port right now. */
export function portFree(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const server = createServer();
    server.once('error', () => resolve(false));
    server.listen(port, '127.0.0.1', () => server.close(() => resolve(true)));
  });
}

/**
 * Polls until the app is healthy, the process exits, or time runs out.
 * With a health path the path must answer < 400; otherwise the port must open.
 */
export async function waitHealthy(options: {
  port: number;
  healthPath: string | null;
  timeoutMs: number;
  isAlive: () => boolean;
  signal?: AbortSignal;
}): Promise<'healthy' | 'exited' | 'timeout' | 'aborted'> {
  const deadline = Date.now() + options.timeoutMs;
  while (Date.now() < deadline) {
    if (options.signal?.aborted) return 'aborted';
    if (!options.isAlive()) return 'exited';
    const ok = options.healthPath
      ? await httpOk(options.port, options.healthPath)
      : await tcpOpen(options.port);
    if (ok) return 'healthy';
    await new Promise((r) => setTimeout(r, 500));
  }
  return 'timeout';
}

import { existsSync } from 'node:fs';
import path from 'node:path';
import type { NestExpressApplication } from '@nestjs/platform-express';
import type { NextFunction, Request, Response } from 'express';

/**
 * Serves the static Next.js export (apps/web/out) from the same origin as the
 * API, so production runs a single Node process (docs/decisions.md D-03).
 * Returns false when no build exists (e.g. during `pnpm dev`, where Next.js
 * serves the UI itself).
 */
export function serveStaticWeb(
  app: NestExpressApplication,
  dir: string,
): boolean {
  const root = path.resolve(dir);
  if (!existsSync(path.join(root, 'index.html'))) return false;

  // Next.js writes both `projects.html` and a `projects/` folder (RSC payloads),
  // so map clean URLs like /projects to their .html file before express.static
  // would redirect to /projects/.
  app.use((req: Request, res: Response, next: NextFunction) => {
    if (req.method !== 'GET' && req.method !== 'HEAD') return next();
    if (req.path.startsWith('/api/') || path.extname(req.path)) return next();
    const clean = req.path.replace(/\/+$/, '');
    if (!clean) return next();
    const file = path.resolve(root, `.${clean}.html`);
    if (!file.startsWith(root + path.sep) || !existsSync(file)) return next();
    return res.sendFile(file);
  });

  app.useStaticAssets(root, { index: 'index.html', redirect: false });

  // Unknown non-API paths get the exported 404 page.
  const notFound = path.join(root, '404.html');
  app.use((req: Request, res: Response, next: NextFunction) => {
    if (req.method !== 'GET' || req.path.startsWith('/api/')) return next();
    if (existsSync(notFound)) return res.status(404).sendFile(notFound);
    return next();
  });
  return true;
}

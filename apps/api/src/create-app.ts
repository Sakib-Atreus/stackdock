import path from 'node:path';
import { Logger, StandardSchemaValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import type { NestApplicationOptions } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import helmet from 'helmet';
import { AppModule } from './app.module.js';
import { ApiExceptionFilter } from './common/filters/api-exception.filter.js';
import { ENV, type Env } from './config/env.js';
import { serveStaticWeb } from './static-web.js';

export const API_PREFIX = 'api/v1';

/** Builds the fully configured app. Shared by main.ts and e2e tests. */
export async function createApp(
  options: NestApplicationOptions = {},
): Promise<NestExpressApplication> {
  const app = await NestFactory.create<NestExpressApplication>(
    AppModule,
    options,
  );
  const env = app.get<Env>(ENV);

  app.disable('x-powered-by');
  if (env.TRUST_PROXY > 0) app.set('trust proxy', env.TRUST_PROXY);
  app.use(
    helmet({
      contentSecurityPolicy: {
        directives: {
          // Next.js static export uses inline bootstrap scripts.
          // TODO(Phase 7): replace 'unsafe-inline' with hashes.
          'script-src': ["'self'", "'unsafe-inline'"],
        },
      },
    }),
  );

  app.setGlobalPrefix(API_PREFIX);
  app.useGlobalPipes(new StandardSchemaValidationPipe());
  app.useGlobalFilters(new ApiExceptionFilter());

  if (env.NODE_ENV === 'development' && env.WEB_URL) {
    app.enableCors({
      origin: new URL(env.WEB_URL).origin,
      credentials: true,
      allowedHeaders: ['Content-Type', 'X-Requested-With'],
    });
  }

  const webDir =
    env.WEB_DIST_DIR ?? path.resolve(import.meta.dirname, '../../web/out');
  const served = serveStaticWeb(app, webDir);
  if (options.logger !== false) {
    new Logger('Bootstrap').log(
      served
        ? `Serving web UI from ${webDir}`
        : 'Web UI build not found; API only',
    );
  }

  app.enableShutdownHooks();
  return app;
}

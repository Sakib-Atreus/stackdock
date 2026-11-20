import 'reflect-metadata';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { Logger } from '@nestjs/common';
import { ENV, type Env } from './config/env.js';

// Local development: load the monorepo root .env if present.
// In production, real environment variables are used.
const rootEnv = path.resolve(import.meta.dirname, '../../../.env');
if (existsSync(rootEnv)) process.loadEnvFile(rootEnv);

const { createApp } = await import('./create-app.js');
const app = await createApp();
const env = app.get<Env>(ENV);
const port = env.PORT ?? env.API_PORT;
await app.listen(port, '0.0.0.0');
new Logger('Bootstrap').log(`StackDock API listening on port ${port}`);

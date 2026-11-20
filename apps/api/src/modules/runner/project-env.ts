import path from 'node:path';

export interface EnvInput {
  dataDir: string;
  slug: string;
  projectEnv: Record<string, string>;
  pathPrefix: string[];
  /** Start step only. */
  runtime?: {
    port: number;
    basePath: string;
    memoryMb: number;
    databaseUrl?: string;
  };
}

const SYSTEM_PATH =
  '/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin';

/**
 * Builds a project's environment from scratch (never from StackDock's own
 * process.env), so StackDock secrets can't leak into project code.
 */
export function buildProjectEnv(input: EnvInput): Record<string, string> {
  const cache = path.join(input.dataDir, 'cache');
  const home = path.join(input.dataDir, 'home', input.slug);
  // Keep the toolchain PATH of the host (e.g. Homebrew/nvm in dev), nothing else.
  const hostPath = process.env.PATH ?? SYSTEM_PATH;

  const base: Record<string, string> = {
    PATH: [...input.pathPrefix, hostPath].join(':'),
    HOME: home,
    TMPDIR: path.join(input.dataDir, 'tmp', input.slug),
    LANG: 'C.UTF-8',
    CI: 'true',
    npm_config_cache: path.join(cache, 'npm'),
    npm_config_update_notifier: 'false',
    PIP_CACHE_DIR: path.join(cache, 'pip'),
    PIP_DISABLE_PIP_VERSION_CHECK: '1',
    GOCACHE: path.join(cache, 'go-build'),
    GOMODCACHE: path.join(cache, 'go-mod'),
    GOPATH: path.join(cache, 'go'),
    GOTOOLCHAIN: 'local',
    GOFLAGS: '-buildvcs=false',
    CGO_ENABLED: '0',
    COMPOSER_HOME: path.join(cache, 'composer'),
    COMPOSER_ALLOW_SUPERUSER: '1',
    PYTHONUNBUFFERED: '1',
  };
  if (
    process.env.VIRTUAL_ENV === undefined &&
    input.pathPrefix.some((p) => p.endsWith('.venv/bin'))
  ) {
    base.VIRTUAL_ENV = path.dirname(
      input.pathPrefix.find((p) => p.endsWith('.venv/bin'))!,
    );
  }

  const env: Record<string, string> = { ...base, ...input.projectEnv };

  if (input.runtime) {
    if (input.runtime.databaseUrl && env.DATABASE_URL === undefined) {
      env.DATABASE_URL = input.runtime.databaseUrl;
    }
    env.NODE_ENV ??= 'production';
    // Set by StackDock; users can't override these (blocked at input too).
    env.PORT = String(input.runtime.port);
    env.HOST = '127.0.0.1';
    env.BASE_PATH = input.runtime.basePath;
    env.NODE_OPTIONS = `--max-old-space-size=${input.runtime.memoryMb}`;
  }
  return env;
}

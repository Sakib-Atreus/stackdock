import { buildProjectEnv } from './project-env.js';

describe('buildProjectEnv', () => {
  it('never includes StackDock secrets from process.env', () => {
    process.env.SESSION_SECRET = 'stackdock-session-secret';
    process.env.CREDENTIAL_ENCRYPTION_KEY = 'stackdock-key';
    process.env.DATABASE_URL = 'postgres://stackdock-main';
    const env = buildProjectEnv({
      dataDir: '/data',
      slug: 'shop',
      projectEnv: {},
      pathPrefix: [],
      runtime: { port: 20001, basePath: '/apps/shop', memoryMb: 256 },
    });
    expect(env.SESSION_SECRET).toBeUndefined();
    expect(env.CREDENTIAL_ENCRYPTION_KEY).toBeUndefined();
    expect(env.DATABASE_URL).toBeUndefined();
  });

  it('adds project vars, runtime vars and caches', () => {
    const env = buildProjectEnv({
      dataDir: '/data',
      slug: 'shop',
      projectEnv: { API_KEY: 'k', NODE_ENV: 'staging' },
      pathPrefix: ['/data/x/node_modules/.bin'],
      runtime: {
        port: 20001,
        basePath: '/apps/shop',
        memoryMb: 128,
        databaseUrl: 'postgres://proj',
      },
    });
    expect(env).toMatchObject({
      API_KEY: 'k',
      NODE_ENV: 'staging',
      PORT: '20001',
      HOST: '127.0.0.1',
      BASE_PATH: '/apps/shop',
      NODE_OPTIONS: '--max-old-space-size=128',
      DATABASE_URL: 'postgres://proj',
      HOME: '/data/home/shop',
    });
    expect(env.PATH!.startsWith('/data/x/node_modules/.bin:')).toBe(true);
  });

  it("keeps the user's own DATABASE_URL over the provisioned one", () => {
    const env = buildProjectEnv({
      dataDir: '/d',
      slug: 's',
      projectEnv: { DATABASE_URL: 'postgres://mine' },
      pathPrefix: [],
      runtime: {
        port: 1,
        basePath: '/',
        memoryMb: 64,
        databaseUrl: 'postgres://provisioned',
      },
    });
    expect(env.DATABASE_URL).toBe('postgres://mine');
  });

  it('build steps get no PORT and default NODE_ENV', () => {
    const env = buildProjectEnv({
      dataDir: '/d',
      slug: 's',
      projectEnv: {},
      pathPrefix: [],
    });
    expect(env.PORT).toBeUndefined();
    expect(env.NODE_ENV).toBeUndefined();
  });
});

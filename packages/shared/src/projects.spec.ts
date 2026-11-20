import {
  branchSchema,
  createProjectSchema,
  envKeySchema,
  repoUrlSchema,
  rootDirSchema,
  setEnvVarSchema,
  updateProjectSchema,
} from './projects.js';

describe('repoUrlSchema', () => {
  it.each([
    ['https://github.com/owner/repo', 'https://github.com/owner/repo'],
    ['https://github.com/owner/repo.git', 'https://github.com/owner/repo'],
    ['https://github.com/owner/repo/', 'https://github.com/owner/repo'],
    [
      '  https://github.com/my-org/my.repo_1 ',
      'https://github.com/my-org/my.repo_1',
    ],
  ])('normalises %s', (input, out) => {
    expect(repoUrlSchema.parse(input)).toBe(out);
  });

  it.each([
    'http://github.com/owner/repo',
    'https://gitlab.com/owner/repo',
    'https://github.com/owner',
    'https://github.com/owner/repo/tree/main',
    'git@github.com:owner/repo.git',
    'https://github.com.evil.com/owner/repo',
    'https://user:pass@github.com/owner/repo',
    'https://github.com/-owner/repo',
  ])('rejects %s', (input) => {
    expect(repoUrlSchema.safeParse(input).success).toBe(false);
  });
});

describe('branchSchema', () => {
  it.each(['main', 'feature/x', 'release-1.2', 'v2_dev'])('accepts %s', (b) => {
    expect(branchSchema.safeParse(b).success).toBe(true);
  });
  it.each([
    '',
    '-main',
    'a..b',
    'a//b',
    '/main',
    'main/',
    'x.lock',
    'a b',
    'main;rm',
  ])('rejects %s', (b) => {
    expect(branchSchema.safeParse(b).success).toBe(false);
  });
});

describe('rootDirSchema', () => {
  it.each([
    ['', '.'],
    ['.', '.'],
    ['./', '.'],
    ['apps/api', 'apps/api'],
    ['apps/api/', 'apps/api'],
    ['./backend', 'backend'],
  ])('normalises %j → %s', (input, out) => {
    expect(rootDirSchema.parse(input)).toBe(out);
  });
  it.each(['/etc', '../x', 'a/../../b', 'a b'])('rejects %s', (p) => {
    expect(rootDirSchema.safeParse(p).success).toBe(false);
  });
});

describe('createProjectSchema', () => {
  const base = {
    slug: 'shop',
    name: 'Shop API',
    repoUrl: 'https://github.com/me/shop',
    branch: 'main',
  };

  it('applies defaults and turns empty strings into null', () => {
    const p = createProjectSchema.parse({
      ...base,
      installCommand: '',
      healthCheckPath: '',
      description: '',
    });
    expect(p).toMatchObject({
      runtime: 'AUTO',
      rootDir: '.',
      installCommand: null,
      healthCheckPath: null,
      description: null,
    });
  });

  it('rejects multi-line commands', () => {
    expect(
      createProjectSchema.safeParse({
        ...base,
        startCommand: 'npm start\nrm -rf /',
      }).success,
    ).toBe(false);
  });

  it('rejects an invalid slug', () => {
    expect(
      createProjectSchema.safeParse({ ...base, slug: 'Too-Long-Name' }).success,
    ).toBe(false);
  });

  it('update cannot change the slug and must change something', () => {
    expect(updateProjectSchema.safeParse({}).success).toBe(false);
    const parsed = updateProjectSchema.parse({
      slug: 'other',
      name: 'X',
    } as object);
    expect(parsed).not.toHaveProperty('slug');
  });
});

describe('envKeySchema', () => {
  it.each(['API_KEY', 'a', '_X', 'DATABASE_URL'])('accepts %s', (k) => {
    expect(envKeySchema.safeParse(k).success).toBe(true);
  });
  it.each([
    '1X',
    'MY-KEY',
    'A B',
    'PORT',
    'port',
    'BASE_PATH',
    'STACKDOCK_X',
    '',
  ])('rejects %s', (k) => {
    expect(envKeySchema.safeParse(k).success).toBe(false);
  });
});

describe('setEnvVarSchema', () => {
  it('allows empty and multi-line values', () => {
    expect(setEnvVarSchema.safeParse({ value: '' }).success).toBe(true);
    expect(
      setEnvVarSchema.safeParse({ value: '-----BEGIN\nKEY\n-----' }).success,
    ).toBe(true);
  });
  it('rejects values over 32 KB', () => {
    expect(
      setEnvVarSchema.safeParse({ value: 'x'.repeat(32 * 1024 + 1) }).success,
    ).toBe(false);
  });
});

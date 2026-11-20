import { parseEnv } from './env.js';

const validKey = Buffer.alloc(32, 7).toString('base64');

const valid = {
  DATABASE_URL: 'postgresql://u:p@localhost:5432/db',
  SESSION_SECRET: 'x'.repeat(32),
  CREDENTIAL_ENCRYPTION_KEY: validKey,
};

describe('parseEnv', () => {
  it('accepts a minimal valid environment and applies defaults', () => {
    const env = parseEnv(valid);
    expect(env.NODE_ENV).toBe('development');
    expect(env.API_PORT).toBe(4000);
    expect(env.ROUTING_MODE).toBe('path');
  });

  it('rejects a missing DATABASE_URL', () => {
    const { DATABASE_URL: _omit, ...rest } = valid;
    expect(() => parseEnv(rest)).toThrow(/DATABASE_URL/);
  });

  it('rejects an encryption key that is not 32 bytes', () => {
    expect(() =>
      parseEnv({ ...valid, CREDENTIAL_ENCRYPTION_KEY: 'too-short' }),
    ).toThrow(/CREDENTIAL_ENCRYPTION_KEY/);
  });

  it('requires a version bump when a previous key is configured', () => {
    expect(() =>
      parseEnv({
        ...valid,
        CREDENTIAL_ENCRYPTION_KEY_PREVIOUS: Buffer.alloc(32, 8).toString(
          'base64',
        ),
      }),
    ).toThrow(/CREDENTIAL_KEY_VERSION/);
  });

  it('never includes secret values in the error message', () => {
    const secret = 'short-secret-value';
    try {
      parseEnv({ ...valid, SESSION_SECRET: secret });
      expect.unreachable();
    } catch (error) {
      expect((error as Error).message).toContain('SESSION_SECRET');
      expect((error as Error).message).not.toContain(secret);
    }
  });
});

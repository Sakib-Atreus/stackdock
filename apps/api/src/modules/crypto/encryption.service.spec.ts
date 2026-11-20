import type { Env } from '../../config/env.js';
import {
  DecryptionError,
  EncryptionService,
  maskSecret,
} from './encryption.service.js';

const key = (fill: number) => Buffer.alloc(32, fill).toString('base64');

function service(overrides: Partial<Env> = {}): EncryptionService {
  return new EncryptionService({
    CREDENTIAL_ENCRYPTION_KEY: key(1),
    CREDENTIAL_KEY_VERSION: 1,
    ...overrides,
  } as Env);
}

describe('EncryptionService', () => {
  const secret = 'nf-token-SUPER-SECRET-value-1234';

  it('round-trips a secret', () => {
    const s = service();
    const encrypted = s.encrypt(secret, 'provider:NORTHFLANK');
    expect(s.decrypt(encrypted, 'provider:NORTHFLANK')).toBe(secret);
  });

  it('never contains the plaintext and uses a fresh IV each time', () => {
    const s = service();
    const a = s.encrypt(secret, 'ctx');
    const b = s.encrypt(secret, 'ctx');
    expect(a).not.toContain(secret);
    expect(a).not.toBe(b);
    expect(a.startsWith('v1.')).toBe(true);
  });

  it('round-trips unicode and empty strings', () => {
    const s = service();
    for (const value of ['', 'পাসওয়ার্ড 🔐', 'a'.repeat(10_000)]) {
      expect(s.decrypt(s.encrypt(value, 'ctx'), 'ctx')).toBe(value);
    }
  });

  it('fails when the context (AAD) differs', () => {
    const s = service();
    const encrypted = s.encrypt(secret, 'envvar:projectA:API_KEY');
    expect(() => s.decrypt(encrypted, 'envvar:projectB:API_KEY')).toThrow(
      DecryptionError,
    );
  });

  it('fails when the ciphertext is tampered with', () => {
    const s = service();
    const parts = s.encrypt(secret, 'ctx').split('.');
    const data = Buffer.from(parts[3]!, 'base64url');
    data[0] = data[0]! ^ 0xff;
    parts[3] = data.toString('base64url');
    expect(() => s.decrypt(parts.join('.'), 'ctx')).toThrow(DecryptionError);
  });

  it('fails with a different key and does not leak input in the error', () => {
    const encrypted = service().encrypt(secret, 'ctx');
    const other = service({ CREDENTIAL_ENCRYPTION_KEY: key(2) });
    try {
      other.decrypt(encrypted, 'ctx');
      expect.unreachable();
    } catch (error) {
      expect(error).toBeInstanceOf(DecryptionError);
      expect((error as Error).message).not.toContain(encrypted);
    }
  });

  it('rejects malformed payloads', () => {
    expect(() => service().decrypt('not-encrypted', 'ctx')).toThrow(
      DecryptionError,
    );
  });

  describe('key rotation', () => {
    it('decrypts old data with the previous key and re-encrypts with the new one', () => {
      const old = service().encrypt(secret, 'ctx');
      const rotated = service({
        CREDENTIAL_ENCRYPTION_KEY: key(2),
        CREDENTIAL_KEY_VERSION: 2,
        CREDENTIAL_ENCRYPTION_KEY_PREVIOUS: key(1),
      });
      expect(rotated.needsReencryption(old)).toBe(true);
      expect(rotated.decrypt(old, 'ctx')).toBe(secret);

      const fresh = rotated.encrypt(secret, 'ctx');
      expect(fresh.startsWith('v2.')).toBe(true);
      expect(rotated.needsReencryption(fresh)).toBe(false);
    });

    it('cannot decrypt old data once the previous key is removed', () => {
      const old = service().encrypt(secret, 'ctx');
      const rotated = service({
        CREDENTIAL_ENCRYPTION_KEY: key(2),
        CREDENTIAL_KEY_VERSION: 2,
      });
      expect(() => rotated.decrypt(old, 'ctx')).toThrow(/key version 1/);
    });
  });
});

describe('maskSecret', () => {
  it('shows only the last 4 characters', () => {
    expect(maskSecret('abcdefghijklmnop')).toBe('mnop');
  });
  it('hides short secrets entirely', () => {
    expect(maskSecret('short')).toBe('••••');
  });
});

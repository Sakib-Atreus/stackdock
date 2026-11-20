import { PasswordService } from './password.service.js';

describe('PasswordService', () => {
  const service = new PasswordService();

  it('produces an Argon2id hash that does not contain the password', async () => {
    const h = await service.hash('correct horse battery');
    expect(h.startsWith('$argon2id$')).toBe(true);
    expect(h).not.toContain('correct horse battery');
  });

  it('verifies the right password and rejects a wrong one', async () => {
    const h = await service.hash('correct horse battery');
    await expect(service.verify(h, 'correct horse battery')).resolves.toBe(
      true,
    );
    await expect(service.verify(h, 'wrong horse battery')).resolves.toBe(false);
  });

  it('returns false (not throw) for a malformed hash', async () => {
    await expect(service.verify('not-a-hash', 'x')).resolves.toBe(false);
  });

  it('salts hashes (same password → different hash)', async () => {
    const [a, b] = await Promise.all([
      service.hash('same password!!'),
      service.hash('same password!!'),
    ]);
    expect(a).not.toBe(b);
  });

  it('verifyDummy always returns false', async () => {
    await expect(service.verifyDummy('anything')).resolves.toBe(false);
  });
});

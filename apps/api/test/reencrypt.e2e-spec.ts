import type { PrismaClient } from '@stackdock/db';
import type { Env } from '../src/config/env.js';
import { EncryptionService } from '../src/modules/crypto/encryption.service.js';
import { reencryptAll } from '../src/modules/crypto/reencrypt.js';
import { envVarContext } from '../src/modules/projects/projects.service.js';
import { NORTHFLANK_CREDENTIAL_CONTEXT } from '../src/modules/providers/provider-connections.service.js';
import { createTestPrisma, resetDatabase } from './support/test-app.js';

const key = (n: number) => Buffer.alloc(32, n).toString('base64');
const enc = (overrides: Partial<Env>) =>
  new EncryptionService({
    CREDENTIAL_ENCRYPTION_KEY: key(1),
    CREDENTIAL_KEY_VERSION: 1,
    ...overrides,
  } as Env);

describe('reencryptAll (integration)', () => {
  let prisma: PrismaClient;
  const token = 'nf-token-to-rotate-0123456789';

  beforeAll(() => {
    prisma = createTestPrisma();
  });
  beforeEach(async () => {
    await resetDatabase(prisma);
    await prisma.providerConnection.create({
      data: {
        provider: 'NORTHFLANK',
        encryptedCredential: enc({}).encrypt(
          token,
          NORTHFLANK_CREDENTIAL_CONTEXT,
        ),
        credentialKeyVersion: 1,
        credentialHint: '6789',
        status: 'CONNECTED',
      },
    });
  });
  afterAll(async () => {
    await prisma.$disconnect();
  });

  it('moves secrets to the new key version', async () => {
    const rotated = enc({
      CREDENTIAL_ENCRYPTION_KEY: key(2),
      CREDENTIAL_KEY_VERSION: 2,
      CREDENTIAL_ENCRYPTION_KEY_PREVIOUS: key(1),
    });
    expect(await reencryptAll(prisma, rotated)).toEqual({
      checked: 1,
      reencrypted: 1,
      failed: 0,
    });

    const row = await prisma.providerConnection.findFirstOrThrow();
    expect(row.credentialKeyVersion).toBe(2);
    // Readable with ONLY the new key now.
    const newOnly = enc({
      CREDENTIAL_ENCRYPTION_KEY: key(2),
      CREDENTIAL_KEY_VERSION: 2,
    });
    expect(
      newOnly.decrypt(row.encryptedCredential, NORTHFLANK_CREDENTIAL_CONTEXT),
    ).toBe(token);

    // Running again is a no-op.
    expect((await reencryptAll(prisma, rotated)).reencrypted).toBe(0);
  });

  it('also rotates project environment variables', async () => {
    const project = await prisma.project.create({
      data: {
        slug: 'shop',
        name: 'Shop',
        repoUrl: 'https://github.com/me/shop',
        branch: 'main',
        publicPort: 10001,
      },
    });
    const ctx = envVarContext(project.id, 'API_KEY');
    await prisma.projectEnvVar.create({
      data: {
        projectId: project.id,
        key: 'API_KEY',
        encryptedValue: enc({}).encrypt('env-secret', ctx),
        keyVersion: 1,
      },
    });
    const rotated = enc({
      CREDENTIAL_ENCRYPTION_KEY: key(2),
      CREDENTIAL_KEY_VERSION: 2,
      CREDENTIAL_ENCRYPTION_KEY_PREVIOUS: key(1),
    });
    expect(await reencryptAll(prisma, rotated)).toEqual({
      checked: 2,
      reencrypted: 2,
      failed: 0,
    });
    const row = await prisma.projectEnvVar.findFirstOrThrow();
    expect(row.keyVersion).toBe(2);
    expect(rotated.decrypt(row.encryptedValue, ctx)).toBe('env-secret');
  });

  it('reports failures when the old key is missing', async () => {
    const withoutPrevious = enc({
      CREDENTIAL_ENCRYPTION_KEY: key(2),
      CREDENTIAL_KEY_VERSION: 2,
    });
    expect(await reencryptAll(prisma, withoutPrevious)).toEqual({
      checked: 1,
      reencrypted: 0,
      failed: 1,
    });
  });
});

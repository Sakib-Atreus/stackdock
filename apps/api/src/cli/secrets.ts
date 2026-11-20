// oxlint-disable no-console -- CLI output is the user interface here.
/**
 * Encryption-key rotation (docs/decisions.md D-09):
 *
 *   1. Generate a new key:      openssl rand -base64 32
 *   2. Set CREDENTIAL_ENCRYPTION_KEY_PREVIOUS = the old key
 *      Set CREDENTIAL_ENCRYPTION_KEY          = the new key
 *      Set CREDENTIAL_KEY_VERSION             = old version + 1
 *   3. Restart StackDock, then run:  node dist/cli/secrets.js reencrypt
 *   4. When it reports 0 failed, remove CREDENTIAL_ENCRYPTION_KEY_PREVIOUS
 *      and restart again.
 */
import { existsSync } from 'node:fs';
import path from 'node:path';
import { createPrismaClient, Prisma } from '@stackdock/db';
import { parseEnv } from '../config/env.js';
import { EncryptionService } from '../modules/crypto/encryption.service.js';
import { reencryptAll } from '../modules/crypto/reencrypt.js';

const rootEnv = path.resolve(import.meta.dirname, '../../../../.env');
if (existsSync(rootEnv)) process.loadEnvFile(rootEnv);

if (process.argv[2] !== 'reencrypt') {
  console.error('Usage: secrets.js reencrypt');
  process.exit(2);
}

const env = parseEnv(process.env);
const prisma = createPrismaClient(env.DATABASE_URL);
try {
  const result = await reencryptAll(prisma, new EncryptionService(env));
  await prisma.activityLog.create({
    data: {
      action: 'secrets.reencrypted',
      status: result.failed === 0 ? 'SUCCESS' : 'FAILURE',
      safeMetadata: {
        ...result,
        keyVersion: env.CREDENTIAL_KEY_VERSION,
      } as Prisma.InputJsonValue,
    },
  });
  console.log(
    `Checked ${result.checked}, re-encrypted ${result.reencrypted}, failed ${result.failed} (current key version ${env.CREDENTIAL_KEY_VERSION}).`,
  );
  if (result.failed > 0) {
    console.error(
      '✖ Some secrets could not be decrypted with the configured keys. Keep CREDENTIAL_ENCRYPTION_KEY_PREVIOUS set and re-enter those secrets in the UI.',
    );
    process.exitCode = 1;
  }
} finally {
  await prisma.$disconnect();
}

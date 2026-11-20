import type { PrismaClient } from '@stackdock/db';
import { envVarContext } from '../projects/projects.service.js';
import { NORTHFLANK_CREDENTIAL_CONTEXT } from '../providers/provider-connections.service.js';
import type { EncryptionService } from './encryption.service.js';

export interface ReencryptResult {
  checked: number;
  reencrypted: number;
  failed: number;
}

/**
 * Re-encrypts every stored secret that isn't on the current key version.
 * Part of the key-rotation procedure (docs/decisions.md D-09).
 * Add new encrypted tables here as they appear (e.g. project env vars).
 */
export async function reencryptAll(
  prisma: PrismaClient,
  encryption: EncryptionService,
): Promise<ReencryptResult> {
  const result: ReencryptResult = { checked: 0, reencrypted: 0, failed: 0 };

  const connections = await prisma.providerConnection.findMany();
  for (const row of connections) {
    result.checked += 1;
    if (!encryption.needsReencryption(row.encryptedCredential)) continue;
    const context =
      row.provider === 'NORTHFLANK' ? NORTHFLANK_CREDENTIAL_CONTEXT : null;
    if (!context) {
      result.failed += 1;
      continue;
    }
    try {
      const plain = encryption.decrypt(row.encryptedCredential, context);
      await prisma.providerConnection.update({
        where: { id: row.id },
        data: {
          encryptedCredential: encryption.encrypt(plain, context),
          credentialKeyVersion: encryption.currentVersion,
        },
      });
      result.reencrypted += 1;
    } catch {
      result.failed += 1;
    }
  }
  const envVars = await prisma.projectEnvVar.findMany();
  for (const row of envVars) {
    result.checked += 1;
    if (!encryption.needsReencryption(row.encryptedValue)) continue;
    const context = envVarContext(row.projectId, row.key);
    try {
      const plain = encryption.decrypt(row.encryptedValue, context);
      await prisma.projectEnvVar.update({
        where: { id: row.id },
        data: {
          encryptedValue: encryption.encrypt(plain, context),
          keyVersion: encryption.currentVersion,
        },
      });
      result.reencrypted += 1;
    } catch {
      result.failed += 1;
    }
  }
  return result;
}

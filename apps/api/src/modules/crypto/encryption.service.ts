import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import { ENV, type Env } from '../../config/env.js';

const ALGORITHM = 'aes-256-gcm';
const IV_BYTES = 12; // 96-bit nonce, the GCM standard
const TAG_BYTES = 16;
const FORMAT = /^v(\d+)\.([A-Za-z0-9_-]+)\.([A-Za-z0-9_-]+)\.([A-Za-z0-9_-]*)$/;

export class DecryptionError extends Error {
  constructor(reason: string) {
    super(`Cannot decrypt credential: ${reason}`);
    this.name = 'DecryptionError';
  }
}

/**
 * Authenticated encryption for secrets at rest (docs/decisions.md D-09).
 *
 * Format: `v<keyVersion>.<iv>.<authTag>.<ciphertext>` (base64url parts).
 * `context` is bound as AAD, so a ciphertext copied into a different row
 * (e.g. another project's env var) fails to decrypt.
 */
@Injectable()
export class EncryptionService {
  private readonly keys = new Map<number, Buffer>();
  readonly currentVersion: number;

  constructor(@Inject(ENV) env: Env) {
    this.currentVersion = env.CREDENTIAL_KEY_VERSION;
    this.keys.set(
      this.currentVersion,
      Buffer.from(env.CREDENTIAL_ENCRYPTION_KEY, 'base64'),
    );
    if (env.CREDENTIAL_ENCRYPTION_KEY_PREVIOUS && this.currentVersion > 1) {
      this.keys.set(
        this.currentVersion - 1,
        Buffer.from(env.CREDENTIAL_ENCRYPTION_KEY_PREVIOUS, 'base64'),
      );
    }
  }

  encrypt(plaintext: string, context: string): string {
    const key = this.keys.get(this.currentVersion)!;
    const iv = randomBytes(IV_BYTES);
    const cipher = createCipheriv(ALGORITHM, key, iv, {
      authTagLength: TAG_BYTES,
    });
    cipher.setAAD(Buffer.from(context, 'utf8'));
    const data = Buffer.concat([
      cipher.update(plaintext, 'utf8'),
      cipher.final(),
    ]);
    return [
      `v${this.currentVersion}`,
      iv.toString('base64url'),
      cipher.getAuthTag().toString('base64url'),
      data.toString('base64url'),
    ].join('.');
  }

  decrypt(payload: string, context: string): string {
    const match = FORMAT.exec(payload);
    if (!match) throw new DecryptionError('unrecognised format');
    const version = Number(match[1]);
    const key = this.keys.get(version);
    if (!key) throw new DecryptionError(`key version ${version} not loaded`);

    const iv = Buffer.from(match[2]!, 'base64url');
    const tag = Buffer.from(match[3]!, 'base64url');
    if (iv.length !== IV_BYTES || tag.length !== TAG_BYTES) {
      throw new DecryptionError('malformed');
    }
    try {
      const decipher = createDecipheriv(ALGORITHM, key, iv, {
        authTagLength: TAG_BYTES,
      });
      decipher.setAAD(Buffer.from(context, 'utf8'));
      decipher.setAuthTag(tag);
      return Buffer.concat([
        decipher.update(Buffer.from(match[4]!, 'base64url')),
        decipher.final(),
      ]).toString('utf8');
    } catch {
      // Wrong key, wrong context or tampered data. Never echo the input.
      throw new DecryptionError('authentication failed');
    }
  }

  /** Key version of a stored ciphertext (for rotation), or null if malformed. */
  static versionOf(payload: string): number | null {
    const match = FORMAT.exec(payload);
    return match ? Number(match[1]) : null;
  }

  needsReencryption(payload: string): boolean {
    return EncryptionService.versionOf(payload) !== this.currentVersion;
  }
}

/** Shows only the last 4 characters, e.g. `••••abcd`. */
export function maskSecret(secret: string): string {
  return secret.length <= 8 ? '••••' : secret.slice(-4);
}

import { Injectable } from '@nestjs/common';
import { hash, verify } from '@node-rs/argon2';

/**
 * Argon2id (the library default) with OWASP-recommended parameters:
 * m=19 MiB, t=2, p=1. Low memory on purpose; the host has ~512 MB.
 */
const ARGON2_OPTIONS = {
  memoryCost: 19_456,
  timeCost: 2,
  parallelism: 1,
} as const;

@Injectable()
export class PasswordService {
  /** Hash of a random string, used to equalise timing for unknown users. */
  private dummyHash?: Promise<string>;

  hash(password: string): Promise<string> {
    return hash(password, ARGON2_OPTIONS);
  }

  async verify(passwordHash: string, password: string): Promise<boolean> {
    try {
      return await verify(passwordHash, password);
    } catch {
      return false;
    }
  }

  /** Spends the same time as a real verify, so response timing doesn't reveal unknown emails. */
  async verifyDummy(password: string): Promise<false> {
    this.dummyHash ??= this.hash(crypto.randomUUID());
    await this.verify(await this.dummyHash, password);
    return false;
  }
}

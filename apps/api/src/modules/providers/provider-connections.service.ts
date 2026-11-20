import { HttpStatus, Inject, Injectable, Logger } from '@nestjs/common';
import { Prisma, type ProviderConnection } from '@stackdock/db';
import type {
  ProviderAccountInfo,
  ProviderConnectionView,
} from '@stackdock/shared';
import { AppError } from '../../common/errors/app-error.js';
import { ENV, type Env } from '../../config/env.js';
import { ActivityService } from '../activity/activity.service.js';
import {
  DecryptionError,
  EncryptionService,
  maskSecret,
} from '../crypto/encryption.service.js';
import { NorthflankClient } from '../northflank/northflank.client.js';
import { NorthflankError } from '../northflank/northflank.errors.js';
import type { NfAuthInfo } from '../northflank/northflank.types.js';
import { PrismaService } from '../prisma/prisma.service.js';

/** AAD context for the Northflank credential (see EncryptionService). */
export const NORTHFLANK_CREDENTIAL_CONTEXT = 'provider:NORTHFLANK';

const ERROR_MESSAGES: Record<string, string> = {
  CREDENTIAL_UNREADABLE:
    'The stored token cannot be decrypted (was the encryption key changed?). Please enter the token again.',
  NF_ORG_TOKEN_UNSUPPORTED:
    'This is an organisation-scoped token. Please create a team API token instead.',
};

export const NOT_CONNECTED = () =>
  new AppError(
    HttpStatus.CONFLICT,
    'PROVIDER_NOT_CONNECTED',
    'Northflank is not connected. Add an API token in Settings.',
  );

@Injectable()
export class ProviderConnectionsService {
  private readonly logger = new Logger(ProviderConnectionsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly encryption: EncryptionService,
    private readonly activity: ActivityService,
    @Inject(ENV) private readonly env: Env,
  ) {}

  /** Overridable in tests. */
  protected createClient(token: string): NorthflankClient {
    return new NorthflankClient({
      baseUrl: this.env.NORTHFLANK_API_URL,
      token,
    });
  }

  async getNorthflank(): Promise<ProviderConnectionView> {
    return toView(await this.find());
  }

  /** Verifies the token with Northflank first; only valid tokens are stored. */
  async connectNorthflank(token: string): Promise<ProviderConnectionView> {
    let info: NfAuthInfo;
    try {
      info = await this.createClient(token).getAuthInfo();
    } catch (error) {
      await this.activity.record({
        action: 'provider.connected',
        status: 'FAILURE',
        targetType: 'Provider',
        targetId: 'NORTHFLANK',
        safeMetadata: { code: errorCode(error) },
      });
      throw error;
    }
    assertSupportedToken(info);

    const existing = await this.find();
    const data = {
      encryptedCredential: this.encryption.encrypt(
        token,
        NORTHFLANK_CREDENTIAL_CONTEXT,
      ),
      credentialKeyVersion: this.encryption.currentVersion,
      credentialHint: maskSecret(token),
      status: 'CONNECTED' as const,
      accountInfo: toAccountInfo(info) as unknown as Prisma.InputJsonValue,
      lastTestedAt: new Date(),
      lastErrorCode: null,
    };
    const row = await this.prisma.client.providerConnection.upsert({
      where: { provider: 'NORTHFLANK' },
      create: { provider: 'NORTHFLANK', ...data },
      update: data,
    });

    await this.activity.record({
      action: 'provider.connected',
      status: 'SUCCESS',
      targetType: 'Provider',
      targetId: 'NORTHFLANK',
      safeMetadata: {
        tokenName: info.name ?? null,
        team: info.entityId,
        replaced: existing !== null,
      },
    });
    return toView(row);
  }

  /** Re-checks the stored token. Records the result; never throws for provider errors. */
  async testNorthflank(): Promise<ProviderConnectionView> {
    const row = await this.find();
    if (!row) throw NOT_CONNECTED();

    let update: Prisma.ProviderConnectionUpdateInput;
    try {
      const info = await this.createClient(this.decrypt(row)).getAuthInfo();
      assertSupportedToken(info);
      update = {
        status: 'CONNECTED',
        accountInfo: toAccountInfo(info) as unknown as Prisma.InputJsonValue,
        lastErrorCode: null,
      };
    } catch (error) {
      if (!(error instanceof AppError)) throw error;
      update = { status: 'ERROR', lastErrorCode: error.code };
    }

    const saved = await this.prisma.client.providerConnection.update({
      where: { id: row.id },
      data: { ...update, lastTestedAt: new Date() },
    });
    await this.activity.record({
      action: 'provider.tested',
      status: saved.status === 'CONNECTED' ? 'SUCCESS' : 'FAILURE',
      targetType: 'Provider',
      targetId: 'NORTHFLANK',
      safeMetadata: saved.lastErrorCode
        ? { code: saved.lastErrorCode }
        : undefined,
    });
    return toView(saved);
  }

  async disconnectNorthflank(): Promise<ProviderConnectionView> {
    const { count } = await this.prisma.client.providerConnection.deleteMany({
      where: { provider: 'NORTHFLANK' },
    });
    if (count > 0) {
      await this.activity.record({
        action: 'provider.disconnected',
        status: 'SUCCESS',
        targetType: 'Provider',
        targetId: 'NORTHFLANK',
      });
    }
    return toView(null);
  }

  /** For later phases: an authenticated client, or PROVIDER_NOT_CONNECTED. */
  async northflankClient(): Promise<NorthflankClient> {
    const row = await this.find();
    if (!row) throw NOT_CONNECTED();
    return this.createClient(this.decrypt(row));
  }

  private find(): Promise<ProviderConnection | null> {
    return this.prisma.client.providerConnection.findUnique({
      where: { provider: 'NORTHFLANK' },
    });
  }

  private decrypt(row: ProviderConnection): string {
    try {
      return this.encryption.decrypt(
        row.encryptedCredential,
        NORTHFLANK_CREDENTIAL_CONTEXT,
      );
    } catch (error) {
      if (error instanceof DecryptionError) {
        this.logger.warn('Stored Northflank credential could not be decrypted');
        throw new AppError(
          HttpStatus.CONFLICT,
          'CREDENTIAL_UNREADABLE',
          ERROR_MESSAGES.CREDENTIAL_UNREADABLE!,
        );
      }
      throw error;
    }
  }
}

function assertSupportedToken(info: NfAuthInfo): void {
  if (info.entityType !== 'team') {
    throw new AppError(
      HttpStatus.BAD_REQUEST,
      'NF_ORG_TOKEN_UNSUPPORTED',
      ERROR_MESSAGES.NF_ORG_TOKEN_UNSUPPORTED!,
    );
  }
}

function toAccountInfo(info: NfAuthInfo): ProviderAccountInfo {
  return {
    tokenName: info.name ?? null,
    entityId: info.entityId,
    entityType: info.entityType,
    roleName: info.role?.name ?? null,
    expiresAt: info.expiresAt ?? null,
  };
}

function errorCode(error: unknown): string {
  return error instanceof AppError ? error.code : 'UNKNOWN';
}

function messageFor(code: string | null): string | null {
  if (!code) return null;
  if (ERROR_MESSAGES[code]) return ERROR_MESSAGES[code];
  if (code.startsWith('NF_')) {
    try {
      return new NorthflankError(code as NorthflankError['nfCode']).message;
    } catch {
      return null;
    }
  }
  return null;
}

export function toView(row: ProviderConnection | null): ProviderConnectionView {
  if (!row) {
    return {
      provider: 'NORTHFLANK',
      connected: false,
      status: null,
      tokenHint: null,
      account: null,
      lastTestedAt: null,
      lastErrorCode: null,
      lastErrorMessage: null,
      connectedAt: null,
    };
  }
  return {
    provider: 'NORTHFLANK',
    connected: true,
    status: row.status,
    tokenHint: row.credentialHint,
    account: (row.accountInfo as ProviderAccountInfo | null) ?? null,
    lastTestedAt: row.lastTestedAt?.toISOString() ?? null,
    lastErrorCode: row.lastErrorCode,
    lastErrorMessage: messageFor(row.lastErrorCode),
    connectedAt: row.createdAt.toISOString(),
  };
}

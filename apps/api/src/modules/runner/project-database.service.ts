import { randomBytes } from 'node:crypto';
import { HttpStatus, Inject, Injectable, Logger } from '@nestjs/common';
import type { ProjectDatabaseView } from '@stackdock/shared';
import pg from 'pg';
import { AppError } from '../../common/errors/app-error.js';
import { ENV, type Env } from '../../config/env.js';
import { ActivityService } from '../activity/activity.service.js';
import { EncryptionService } from '../crypto/encryption.service.js';
import { PrismaService } from '../prisma/prisma.service.js';

export function projectDbContext(projectId: string): string {
  return `projectdb:${projectId}`;
}

/** proj_<slug> / proj_<slug>_user. Slugs are [a-z0-9-], so this is always a safe identifier. */
export function projectDbNames(slug: string): {
  dbName: string;
  roleName: string;
} {
  if (!/^[a-z][a-z0-9-]{0,7}$/.test(slug)) throw new Error('Invalid slug');
  const base = `proj_${slug.replace(/-/g, '_')}`;
  return { dbName: base, roleName: `${base}_user` };
}

const ident = (name: string) => {
  if (!/^[a-z_][a-z0-9_]*$/.test(name)) throw new Error('Unsafe identifier');
  return `"${name}"`;
};

/**
 * One Postgres database + login role per project inside StackDock's own
 * Postgres (D-12). Uses the admin connection only for provisioning.
 *
 * Isolation: the database is owned by the admin, CONNECT is revoked from
 * PUBLIC and granted only to the project's role, which gets CREATE on the
 * public schema. Roles are NOSUPERUSER/NOCREATEDB/NOCREATEROLE. Works without
 * superuser (no SET ROLE needed).
 */
@Injectable()
export class ProjectDatabaseService {
  private readonly logger = new Logger(ProjectDatabaseService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly encryption: EncryptionService,
    private readonly activity: ActivityService,
    @Inject(ENV) private readonly env: Env,
  ) {}

  private get adminUrl(): string {
    return this.env.PROJECT_DB_ADMIN_URL ?? this.env.DATABASE_URL;
  }

  async view(projectId: string): Promise<ProjectDatabaseView> {
    const row = await this.prisma.client.projectDatabase.findUnique({
      where: { projectId },
    });
    const own = await this.prisma.client.projectEnvVar.findUnique({
      where: { projectId_key: { projectId, key: 'DATABASE_URL' } },
      select: { id: true },
    });
    const host = new URL(this.adminUrl);
    return {
      exists: Boolean(row),
      dbName: row?.dbName ?? null,
      roleName: row?.roleName ?? null,
      host: row ? `${host.hostname}:${host.port || '5432'}` : null,
      createdAt: row?.createdAt.toISOString() ?? null,
      overriddenByEnv: Boolean(own),
    };
  }

  /** The URL injected as DATABASE_URL, or null. Server-side only. */
  async connectionUrl(projectId: string): Promise<string | null> {
    const row = await this.prisma.client.projectDatabase.findUnique({
      where: { projectId },
    });
    if (!row) return null;
    const password = this.encryption.decrypt(
      row.encryptedPassword,
      projectDbContext(projectId),
    );
    const url = new URL(this.adminUrl);
    url.username = row.roleName;
    url.password = password;
    url.pathname = `/${row.dbName}`;
    // Keep only TLS-related query params (e.g. sslmode) from the admin URL.
    // Copy the keys first: deleting while iterating the live iterator skips entries.
    // oxlint-disable-next-line unicorn/no-useless-spread
    for (const key of [...url.searchParams.keys()]) {
      if (!key.startsWith('ssl')) url.searchParams.delete(key);
    }
    return url.toString();
  }

  async create(projectId: string, slug: string): Promise<ProjectDatabaseView> {
    if (
      await this.prisma.client.projectDatabase.findUnique({
        where: { projectId },
      })
    ) {
      throw new AppError(
        HttpStatus.CONFLICT,
        'DATABASE_EXISTS',
        'This project already has a database.',
      );
    }
    const { dbName, roleName } = projectDbNames(slug);
    const password = randomBytes(24).toString('hex');

    await this.withAdmin(async (admin) => {
      const exists = await admin.query(
        'SELECT 1 FROM pg_database WHERE datname = $1',
        [dbName],
      );
      if (exists.rowCount) {
        throw new AppError(
          HttpStatus.CONFLICT,
          'DATABASE_NAME_TAKEN',
          `A database named ${dbName} already exists on the server. Remove it first.`,
        );
      }
      await admin.query(
        `CREATE ROLE ${ident(roleName)} LOGIN PASSWORD '${password}' NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION CONNECTION LIMIT 20`,
      );
      try {
        await admin.query(`CREATE DATABASE ${ident(dbName)}`);
        await admin.query(
          `REVOKE ALL ON DATABASE ${ident(dbName)} FROM PUBLIC`,
        );
        await admin.query(
          `GRANT CONNECT, TEMPORARY ON DATABASE ${ident(dbName)} TO ${ident(roleName)}`,
        );
        await this.withAdmin(async (inDb) => {
          await inDb.query(`REVOKE ALL ON SCHEMA public FROM PUBLIC`);
          await inDb.query(
            `GRANT USAGE, CREATE ON SCHEMA public TO ${ident(roleName)}`,
          );
        }, dbName);
      } catch (error) {
        await admin
          .query(`DROP DATABASE IF EXISTS ${ident(dbName)}`)
          .catch(() => undefined);
        await admin
          .query(`DROP ROLE IF EXISTS ${ident(roleName)}`)
          .catch(() => undefined);
        throw error;
      }
    });

    await this.prisma.client.projectDatabase.create({
      data: {
        projectId,
        dbName,
        roleName,
        encryptedPassword: this.encryption.encrypt(
          password,
          projectDbContext(projectId),
        ),
        keyVersion: this.encryption.currentVersion,
      },
    });
    await this.activity.record({
      action: 'project.db_created',
      status: 'SUCCESS',
      targetType: 'Project',
      targetId: projectId,
      safeMetadata: { slug, dbName },
    });
    return this.view(projectId);
  }

  /** Drops the database and role. All data is lost. */
  async drop(projectId: string, slug: string): Promise<ProjectDatabaseView> {
    const row = await this.prisma.client.projectDatabase.findUnique({
      where: { projectId },
    });
    if (!row)
      throw new AppError(
        HttpStatus.NOT_FOUND,
        'DATABASE_NOT_FOUND',
        'This project has no database.',
      );
    await this.withAdmin(async (admin) => {
      await admin.query(
        'SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = $1 AND pid <> pg_backend_pid()',
        [row.dbName],
      );
      await admin.query(`DROP DATABASE IF EXISTS ${ident(row.dbName)}`);
      await admin.query(`DROP ROLE IF EXISTS ${ident(row.roleName)}`);
    });
    await this.prisma.client.projectDatabase.delete({ where: { id: row.id } });
    await this.activity.record({
      action: 'project.db_deleted',
      status: 'SUCCESS',
      targetType: 'Project',
      targetId: projectId,
      safeMetadata: { slug, dbName: row.dbName },
    });
    return this.view(projectId);
  }

  private async withAdmin<T>(
    fn: (client: pg.Client) => Promise<T>,
    database?: string,
  ): Promise<T> {
    const url = new URL(this.adminUrl);
    if (database) url.pathname = `/${database}`;
    const client = new pg.Client({
      connectionString: url.toString(),
      connectionTimeoutMillis: 10_000,
    });
    try {
      await client.connect();
    } catch {
      throw new AppError(
        HttpStatus.BAD_GATEWAY,
        'DATABASE_ADMIN_UNAVAILABLE',
        'Could not connect to Postgres with the admin connection.',
      );
    }
    try {
      return await fn(client);
    } catch (error) {
      if (error instanceof AppError) throw error;
      const code = (error as { code?: string }).code;
      this.logger.warn(`Provisioning query failed (${code ?? 'unknown'})`);
      throw new AppError(
        code === '42501' ? HttpStatus.FORBIDDEN : HttpStatus.BAD_GATEWAY,
        code === '42501'
          ? 'DATABASE_PERMISSION_DENIED'
          : 'DATABASE_PROVISIONING_FAILED',
        code === '42501'
          ? 'The Postgres admin user is not allowed to create databases/roles. Set PROJECT_DB_ADMIN_URL to an admin connection.'
          : 'Postgres rejected the database operation.',
      );
    } finally {
      await client.end().catch(() => undefined);
    }
  }
}

import { HttpStatus, Injectable } from '@nestjs/common';
import { Prisma, type Project } from '@stackdock/db';
import type {
  CreateProjectInput,
  EnvVarView,
  ProjectView,
  UpdateProjectInput,
} from '@stackdock/shared';
import { AppError } from '../../common/errors/app-error.js';
import { ActivityService } from '../activity/activity.service.js';
import { EncryptionService } from '../crypto/encryption.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { lowestFreePort } from './project-ports.js';

type ProjectWithCount = Project & { _count: { envVars: number } };

const notFound = () =>
  new AppError(HttpStatus.NOT_FOUND, 'PROJECT_NOT_FOUND', 'Project not found.');
const archived = () =>
  new AppError(
    HttpStatus.CONFLICT,
    'PROJECT_ARCHIVED',
    'This project is archived. Restore it first.',
  );

/** AAD context: binds each encrypted value to its project and key. */
export function envVarContext(projectId: string, key: string): string {
  return `envvar:${projectId}:${key}`;
}

@Injectable()
export class ProjectsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly encryption: EncryptionService,
    private readonly activity: ActivityService,
  ) {}

  async list(includeArchived: boolean): Promise<ProjectView[]> {
    const rows = await this.prisma.client.project.findMany({
      where: includeArchived
        ? { archivedAt: { not: null } }
        : { archivedAt: null },
      orderBy: { createdAt: 'asc' },
      include: { _count: { select: { envVars: true } } },
    });
    return rows.map(toView);
  }

  async get(slug: string): Promise<ProjectView> {
    return toView(await this.find(slug));
  }

  async create(input: CreateProjectInput): Promise<ProjectView> {
    const existing = await this.prisma.client.project.findUnique({
      where: { slug: input.slug },
      select: { archivedAt: true },
    });
    if (existing) {
      throw new AppError(
        HttpStatus.CONFLICT,
        'SLUG_TAKEN',
        existing.archivedAt
          ? 'An archived project already uses this name. Restore or delete it first.'
          : 'A project with this name already exists.',
        { field: 'slug' },
      );
    }

    // Port allocation can race with another create; retry on unique conflict.
    for (let attempt = 0; attempt < 3; attempt++) {
      const used = await this.prisma.client.project.findMany({
        select: { publicPort: true },
      });
      const publicPort = lowestFreePort(used.map((p) => p.publicPort));
      if (publicPort === null) {
        throw new AppError(
          HttpStatus.CONFLICT,
          'PROJECT_LIMIT_REACHED',
          'No free project ports left. Delete unused projects first.',
        );
      }
      try {
        const row = await this.prisma.client.project.create({
          data: { ...input, publicPort },
          include: { _count: { select: { envVars: true } } },
        });
        await this.activity.record({
          action: 'project.created',
          status: 'SUCCESS',
          targetType: 'Project',
          targetId: row.id,
          safeMetadata: { slug: row.slug, repo: row.repoUrl },
        });
        return toView(row);
      } catch (error) {
        if (!isUniqueViolation(error)) throw error;
        const slugNowTaken = await this.prisma.client.project.findUnique({
          where: { slug: input.slug },
          select: { id: true },
        });
        if (slugNowTaken) {
          throw new AppError(
            HttpStatus.CONFLICT,
            'SLUG_TAKEN',
            'A project with this name already exists.',
            { field: 'slug' },
          );
        }
      }
    }
    throw new AppError(
      HttpStatus.CONFLICT,
      'CONFLICT',
      'Could not allocate a port. Please try again.',
    );
  }

  async update(slug: string, input: UpdateProjectInput): Promise<ProjectView> {
    const project = await this.find(slug);
    if (project.archivedAt) throw archived();

    const changed = (
      Object.keys(input) as Array<keyof UpdateProjectInput>
    ).filter((k) => input[k] !== undefined && input[k] !== project[k]);
    if (changed.length === 0) return toView(project);

    const row = await this.prisma.client.project.update({
      where: { id: project.id },
      data: input,
      include: { _count: { select: { envVars: true } } },
    });
    await this.activity.record({
      action: 'project.updated',
      status: 'SUCCESS',
      targetType: 'Project',
      targetId: row.id,
      safeMetadata: { slug: row.slug, fields: changed },
    });
    return toView(row);
  }

  /** "Remove from dashboard" (reversible). Never touches Northflank. */
  async archive(slug: string): Promise<ProjectView> {
    const project = await this.find(slug);
    if (project.archivedAt) return toView(project);
    const row = await this.prisma.client.project.update({
      where: { id: project.id },
      data: { archivedAt: new Date(), desiredState: 'STOPPED' },
      include: { _count: { select: { envVars: true } } },
    });
    await this.audit('project.archived', row);
    return toView(row);
  }

  async restore(slug: string): Promise<ProjectView> {
    const project = await this.find(slug);
    if (!project.archivedAt) return toView(project);
    const row = await this.prisma.client.project.update({
      where: { id: project.id },
      data: { archivedAt: null },
      include: { _count: { select: { envVars: true } } },
    });
    await this.audit('project.restored', row);
    return toView(row);
  }

  /** Permanent. Only for archived projects, and the caller must retype the slug. */
  async delete(slug: string, confirmSlug: string): Promise<void> {
    const project = await this.find(slug);
    if (!project.archivedAt) {
      throw new AppError(
        HttpStatus.CONFLICT,
        'PROJECT_NOT_ARCHIVED',
        'Archive the project before deleting it permanently.',
      );
    }
    if (confirmSlug !== project.slug) {
      throw new AppError(
        HttpStatus.BAD_REQUEST,
        'CONFIRMATION_MISMATCH',
        'Type the project name exactly to confirm.',
        { field: 'confirmSlug' },
      );
    }
    await this.prisma.client.project.delete({ where: { id: project.id } });
    await this.audit('project.deleted', project);
  }

  // ── Environment variables ─────────────────────────────────────────────

  async listEnv(slug: string): Promise<EnvVarView[]> {
    const project = await this.find(slug);
    const rows = await this.prisma.client.projectEnvVar.findMany({
      where: { projectId: project.id },
      orderBy: { key: 'asc' },
      select: { key: true, createdAt: true, updatedAt: true },
    });
    return rows.map((r) => ({
      key: r.key,
      createdAt: r.createdAt.toISOString(),
      updatedAt: r.updatedAt.toISOString(),
    }));
  }

  async setEnv(
    slug: string,
    key: string,
    value: string,
  ): Promise<{ key: string; replaced: boolean }> {
    const project = await this.find(slug);
    if (project.archivedAt) throw archived();
    const encryptedValue = this.encryption.encrypt(
      value,
      envVarContext(project.id, key),
    );
    const existing = await this.prisma.client.projectEnvVar.findUnique({
      where: { projectId_key: { projectId: project.id, key } },
      select: { id: true },
    });
    await this.prisma.client.projectEnvVar.upsert({
      where: { projectId_key: { projectId: project.id, key } },
      create: {
        projectId: project.id,
        key,
        encryptedValue,
        keyVersion: this.encryption.currentVersion,
      },
      update: { encryptedValue, keyVersion: this.encryption.currentVersion },
    });
    await this.activity.record({
      action: 'project.env_set',
      status: 'SUCCESS',
      targetType: 'Project',
      targetId: project.id,
      safeMetadata: { slug: project.slug, key, replaced: existing !== null },
    });
    return { key, replaced: existing !== null };
  }

  async deleteEnv(slug: string, key: string): Promise<void> {
    const project = await this.find(slug);
    if (project.archivedAt) throw archived();
    const { count } = await this.prisma.client.projectEnvVar.deleteMany({
      where: { projectId: project.id, key },
    });
    if (count === 0) {
      throw new AppError(
        HttpStatus.NOT_FOUND,
        'ENV_VAR_NOT_FOUND',
        'Variable not found.',
      );
    }
    await this.activity.record({
      action: 'project.env_deleted',
      status: 'SUCCESS',
      targetType: 'Project',
      targetId: project.id,
      safeMetadata: { slug: project.slug, key },
    });
  }

  /** For the runner (Phase 5): decrypted env for a project. Server-side only. */
  async decryptedEnv(projectId: string): Promise<Record<string, string>> {
    const rows = await this.prisma.client.projectEnvVar.findMany({
      where: { projectId },
    });
    return Object.fromEntries(
      rows.map((r) => [
        r.key,
        this.encryption.decrypt(
          r.encryptedValue,
          envVarContext(projectId, r.key),
        ),
      ]),
    );
  }

  private async find(slug: string): Promise<ProjectWithCount> {
    const row = await this.prisma.client.project.findUnique({
      where: { slug },
      include: { _count: { select: { envVars: true } } },
    });
    if (!row) throw notFound();
    return row;
  }

  private audit(
    action: 'project.archived' | 'project.restored' | 'project.deleted',
    project: Project,
  ) {
    return this.activity.record({
      action,
      status: 'SUCCESS',
      targetType: 'Project',
      targetId: project.id,
      safeMetadata: { slug: project.slug },
    });
  }
}

function isUniqueViolation(error: unknown): boolean {
  return (
    error instanceof Prisma.PrismaClientKnownRequestError &&
    error.code === 'P2002'
  );
}

export function toView(row: ProjectWithCount): ProjectView {
  return {
    id: row.id,
    slug: row.slug,
    name: row.name,
    description: row.description,
    repoUrl: row.repoUrl,
    branch: row.branch,
    runtime: row.runtime,
    rootDir: row.rootDir,
    installCommand: row.installCommand,
    buildCommand: row.buildCommand,
    startCommand: row.startCommand,
    healthCheckPath: row.healthCheckPath,
    status: row.status,
    desiredState: row.desiredState,
    publicPort: row.publicPort,
    lastCommitSha: row.lastCommitSha,
    lastDeployedAt: row.lastDeployedAt?.toISOString() ?? null,
    archivedAt: row.archivedAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    envVarCount: row._count.envVars,
    pathUrl: `/apps/${row.slug}/`,
  };
}

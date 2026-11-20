import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import {
  NF_BUILD_ACTIVE,
  type ExposeResult,
  type NfBuildView,
  type NfProjectView,
  type NfSelfView,
  type NfServiceDetailView,
  type NfServiceView,
} from '@stackdock/shared';
import { AppError } from '../../common/errors/app-error.js';
import { ENV, type Env } from '../../config/env.js';
import { ActivityService } from '../activity/activity.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { ProviderConnectionsService } from '../providers/provider-connections.service.js';
import type { NorthflankClient } from './northflank.client.js';
import type { NfPort, NfService } from './northflank.types.js';
import { ownUrlFor } from './own-url.js';

const CACHE_MS = 15_000;
/** Request fields of a port per the PATCH schema (anything else is dropped). */
const PORT_FIELDS = [
  'name',
  'internalPort',
  'public',
  'vpcAccessible',
  'security',
  'domains',
  'disableNfDomain',
  'advancedOptions',
  'protocol',
] as const;

const notOnNorthflank = () =>
  new AppError(
    HttpStatus.CONFLICT,
    'NOT_ON_NORTHFLANK',
    'StackDock is not running on Northflank, so it cannot add public ports. Use the /apps/<name>/ URL instead.',
  );

/**
 * Read-mostly Northflank features: list projects/services/builds, start a
 * build, and manage StackDock's own public ports (one per project, D-15).
 * GET results are cached briefly (Northflank allows 1000 requests/hour).
 */
@Injectable()
export class NorthflankService {
  private readonly cache = new Map<string, { at: number; value: unknown }>();

  constructor(
    private readonly connections: ProviderConnectionsService,
    private readonly prisma: PrismaService,
    private readonly activity: ActivityService,
    @Inject(ENV) private readonly env: Env,
  ) {}

  async projects(refresh = false): Promise<NfProjectView[]> {
    return this.cached('projects', refresh, async (c) =>
      (await c.listProjects()).map((p) => ({
        id: p.id,
        name: p.name,
        description: p.description ?? null,
      })),
    );
  }

  async services(projectId: string, refresh = false): Promise<NfServiceView[]> {
    return this.cached(`services:${projectId}`, refresh, async (c) =>
      (await c.listServices(projectId)).map((s) => ({
        id: s.id,
        name: s.name,
        type: s.serviceType,
        buildStatus: s.status?.build?.status ?? null,
        deploymentStatus: s.status?.deployment?.status ?? null,
        lastChange:
          s.status?.deployment?.lastTransitionTime ??
          s.status?.build?.lastTransitionTime ??
          null,
      })),
    );
  }

  async service(
    projectId: string,
    serviceId: string,
    refresh = false,
  ): Promise<NfServiceDetailView> {
    return this.cached(
      `service:${projectId}:${serviceId}`,
      refresh,
      async (c) => {
        const s = await c.getService(projectId, serviceId);
        const canBuild =
          s.serviceType === 'combined' || s.serviceType === 'build';
        const builds = canBuild ? await c.listBuilds(projectId, serviceId) : [];
        return {
          id: s.id,
          name: s.name,
          type: s.serviceType,
          buildStatus: s.status?.build?.status ?? null,
          deploymentStatus: s.status?.deployment?.status ?? null,
          lastChange: s.status?.deployment?.lastTransitionTime ?? null,
          branch: s.vcsData?.projectBranch ?? null,
          repoUrl: s.vcsData?.projectUrl ?? null,
          canBuild,
          builds: builds.map((b): NfBuildView => ({
            id: b.id,
            branch: b.branch ?? null,
            sha: b.sha ?? null,
            status: b.status ?? null,
            concluded: b.concluded ?? !NF_BUILD_ACTIVE.includes(b.status ?? ''),
            success: b.success ?? null,
            message: b.message ?? null,
            createdAt: toIso(b.createdAt),
          })),
        };
      },
    );
  }

  /** Starts a build. Not retried, and records the result in the audit log. */
  async startBuild(
    projectId: string,
    serviceId: string,
    branch?: string,
  ): Promise<NfBuildView> {
    const client = await this.connections.northflankClient();
    try {
      const b = await client.startBuild(
        projectId,
        serviceId,
        branch ? { branch } : {},
      );
      this.invalidate(projectId, serviceId);
      await this.audit('northflank.build_started', 'SUCCESS', {
        projectId,
        serviceId,
        branch: branch ?? null,
        buildId: b.id,
      });
      return {
        id: b.id,
        branch: b.branch ?? branch ?? null,
        sha: b.sha ?? null,
        status: b.status ?? 'QUEUED',
        concluded: false,
        success: null,
        message: null,
        createdAt: new Date().toISOString(),
      };
    } catch (error) {
      await this.audit('northflank.build_started', 'FAILURE', {
        projectId,
        serviceId,
        code: error instanceof AppError ? error.code : 'UNKNOWN',
      });
      throw error;
    }
  }

  // ── StackDock's own service: one public port per project ───────────

  async self(): Promise<NfSelfView> {
    const base: NfSelfView = {
      onNorthflank: Boolean(this.env.NF_PROJECT_ID && this.env.NF_OBJECT_ID),
      projectId: this.env.NF_PROJECT_ID ?? null,
      serviceId: this.env.NF_OBJECT_ID ?? null,
      serviceType: null,
      routingMode: this.env.ROUTING_MODE,
      ports: [],
      problem: null,
    };
    if (!base.onNorthflank) {
      return { ...base, problem: 'StackDock is not running on Northflank.' };
    }
    try {
      const svc = await this.selfService(false);
      return {
        ...base,
        serviceType: svc.serviceType,
        ports: (svc.ports ?? []).map((p) => ({
          name: p.name,
          internalPort: p.internalPort,
          public: Boolean(p.public),
          url: p.public ? ownUrlFor(p.name, this.env.NF_HOSTS) : null,
        })),
        problem:
          this.env.ROUTING_MODE !== 'northflank-ports'
            ? 'Set ROUTING_MODE=northflank-ports so StackDock listens on each project port.'
            : null,
      };
    } catch (error) {
      return {
        ...base,
        problem:
          error instanceof AppError
            ? error.message
            : 'Could not read the service.',
      };
    }
  }

  /** Adds a public HTTP port named after the project (its own URL). Redeploys StackDock. */
  async expose(slug: string): Promise<ExposeResult> {
    const project = await this.findProject(slug);
    if (project.archivedAt) {
      throw new AppError(
        HttpStatus.CONFLICT,
        'PROJECT_ARCHIVED',
        'Restore the project first.',
      );
    }
    if (this.env.ROUTING_MODE !== 'northflank-ports') {
      throw new AppError(
        HttpStatus.CONFLICT,
        'WRONG_ROUTING_MODE',
        'Set ROUTING_MODE=northflank-ports on StackDock first, otherwise the new port would not answer.',
      );
    }
    const svc = await this.selfService(true);
    const ports = svc.ports ?? [];
    const existing = ports.find((p) => p.name === slug);
    if (existing && existing.internalPort !== project.publicPort) {
      throw new AppError(
        HttpStatus.CONFLICT,
        'PORT_NAME_TAKEN',
        `StackDock's service already has a port named "${slug}" for another internal port.`,
      );
    }
    const clash = ports.find(
      (p) => p.internalPort === project.publicPort && p.name !== slug,
    );
    if (clash) {
      throw new AppError(
        HttpStatus.CONFLICT,
        'PORT_NUMBER_TAKEN',
        `Internal port ${project.publicPort} is already used by port "${clash.name}".`,
      );
    }

    let restarting = false;
    if (!existing) {
      await this.patchPorts(
        svc,
        [
          ...ports.map(cleanPort),
          {
            name: slug,
            internalPort: project.publicPort,
            public: true,
            protocol: 'HTTP',
          },
        ],
        'project.exposed',
        project.id,
        slug,
      );
      restarting = true;
    }
    await this.prisma.client.project.update({
      where: { id: project.id },
      data: { exposedAt: new Date() },
    });
    return { restarting, portName: slug };
  }

  /** Removes the project's public port. Redeploys StackDock. */
  async unexpose(slug: string): Promise<ExposeResult> {
    const project = await this.findProject(slug);
    let restarting = false;
    if (this.env.NF_PROJECT_ID && this.env.NF_OBJECT_ID) {
      const svc = await this.selfService(true);
      const ports = svc.ports ?? [];
      const ours = ports.find(
        (p) => p.name === slug && p.internalPort === project.publicPort,
      );
      if (ours) {
        await this.patchPorts(
          svc,
          ports.filter((p) => p !== ours).map(cleanPort),
          'project.unexposed',
          project.id,
          slug,
        );
        restarting = true;
      }
    }
    await this.prisma.client.project.update({
      where: { id: project.id },
      data: { exposedAt: null },
    });
    return { restarting, portName: slug };
  }

  // ── helpers ──────────────────────────────────────────────────────────

  private async selfService(refresh: boolean): Promise<NfService> {
    if (!this.env.NF_PROJECT_ID || !this.env.NF_OBJECT_ID)
      throw notOnNorthflank();
    const projectId = this.env.NF_PROJECT_ID;
    const serviceId = this.env.NF_OBJECT_ID;
    return this.cached(`self:${projectId}:${serviceId}`, refresh, (c) =>
      c.getService(projectId, serviceId),
    );
  }

  private async patchPorts(
    svc: NfService,
    ports: NfPort[],
    action: 'project.exposed' | 'project.unexposed',
    projectId: string,
    slug: string,
  ): Promise<void> {
    if (svc.serviceType !== 'combined' && svc.serviceType !== 'deployment') {
      throw new AppError(
        HttpStatus.CONFLICT,
        'UNSUPPORTED_SERVICE',
        'StackDock must run as a combined or deployment service.',
      );
    }
    const client = await this.connections.northflankClient();
    try {
      await client.setServicePorts(
        this.env.NF_PROJECT_ID!,
        this.env.NF_OBJECT_ID!,
        svc.serviceType,
        ports,
      );
    } catch (error) {
      await this.activity.record({
        action,
        status: 'FAILURE',
        targetType: 'Project',
        targetId: projectId,
        safeMetadata: {
          slug,
          code: error instanceof AppError ? error.code : 'UNKNOWN',
        },
      });
      throw error;
    }
    this.cache.delete(
      `self:${this.env.NF_PROJECT_ID}:${this.env.NF_OBJECT_ID}`,
    );
    await this.activity.record({
      action,
      status: 'SUCCESS',
      targetType: 'Project',
      targetId: projectId,
      safeMetadata: { slug, ports: ports.map((p) => p.name) },
    });
  }

  private async findProject(slug: string) {
    const project = await this.prisma.client.project.findUnique({
      where: { slug },
    });
    if (!project)
      throw new AppError(
        HttpStatus.NOT_FOUND,
        'PROJECT_NOT_FOUND',
        'Project not found.',
      );
    return project;
  }

  private async cached<T>(
    key: string,
    refresh: boolean,
    load: (c: NorthflankClient) => Promise<T>,
  ): Promise<T> {
    const hit = this.cache.get(key);
    if (!refresh && hit && Date.now() - hit.at < CACHE_MS)
      return hit.value as T;
    const value = await load(await this.connections.northflankClient());
    this.cache.set(key, { at: Date.now(), value });
    return value;
  }

  private invalidate(projectId: string, serviceId: string): void {
    this.cache.delete(`service:${projectId}:${serviceId}`);
    this.cache.delete(`services:${projectId}`);
  }

  private audit(
    action: 'northflank.build_started',
    status: 'SUCCESS' | 'FAILURE',
    meta: Record<string, string | null>,
  ) {
    return this.activity.record({
      action,
      status,
      targetType: 'NorthflankService',
      targetId: meta.serviceId ?? undefined,
      safeMetadata: meta,
    });
  }
}

function cleanPort(port: NfPort): NfPort {
  const out: Record<string, unknown> = {};
  for (const key of PORT_FIELDS) {
    if (port[key] !== undefined) out[key] = port[key];
  }
  return out as NfPort;
}

function toIso(value: string | number | undefined): string | null {
  if (value === undefined) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

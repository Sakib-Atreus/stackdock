import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  writeFileSync,
} from 'node:fs';
import path from 'node:path';
import {
  HttpStatus,
  Inject,
  Injectable,
  Logger,
  type OnApplicationBootstrap,
  type OnApplicationShutdown,
} from '@nestjs/common';
import type { DeploymentStatus, Project } from '@stackdock/db';
import type { DeploymentView, RuntimeLogPage } from '@stackdock/shared';
import { AppError } from '../../common/errors/app-error.js';
import { ENV, type Env } from '../../config/env.js';
import { ActivityService } from '../activity/activity.service.js';
import { EncryptionService } from '../crypto/encryption.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { envVarContext } from '../projects/projects.service.js';
import { SerialQueue } from './build-queue.js';
import { DetectionError, type Plan, planBuild } from './detect.js';
import { dirSizeBytes, removeDir, resolveInside } from './fs-utils.js';
import { shallowClone } from './git.js';
import { BoundedText } from './log-buffer.js';
import { privatePort } from './ports.js';
import { portFree } from './health.js';
import { runCommand } from './process.js';
import { buildProjectEnv } from './project-env.js';
import { ProjectDatabaseService } from './project-database.service.js';
import { Redactor } from './redactor.js';
import { type Instance, type StartSpec, Supervisor } from './supervisor.js';

const ACTIVE: DeploymentStatus[] = [
  'QUEUED',
  'CLONING',
  'INSTALLING',
  'BUILDING',
  'STARTING',
];
const READY_MARKER = '.stackdock-ready.json';
const CRASH_WINDOW_MS = 10 * 60_000;
const MAX_CRASH_RESTARTS = 5;

/** What we persist next to a finished build so it can be restarted without rebuilding. */
interface ReadyInfo {
  appDir: string;
  plan: Plan;
}

class StepFailed extends Error {}

/**
 * Orchestrates deployments: queue → clone → install → build → start
 * (blue/green) → live. Also stop/restart, crash policy, boot restore.
 */
@Injectable()
export class RunnerService
  implements OnApplicationBootstrap, OnApplicationShutdown
{
  private readonly logger = new Logger(RunnerService.name);
  readonly supervisor: Supervisor;
  private readonly queue = new SerialQueue();
  private readonly dataDir: string;
  /** Abort controllers for queued or running deployments. */
  private readonly controllers = new Map<string, AbortController>();
  private readonly crashTimes = new Map<string, number[]>();
  private readonly restartTimers = new Map<string, NodeJS.Timeout>();
  private shuttingDown = false;
  /** Called when a project's live process changes (used by the per-port listeners). */
  onLiveChange?: (slug: string) => void;
  /** Called when a project is torn down (archive/delete). */
  onTeardown?: (slug: string) => Promise<void>;

  constructor(
    private readonly prisma: PrismaService,
    private readonly encryption: EncryptionService,
    private readonly activity: ActivityService,
    private readonly databases: ProjectDatabaseService,
    @Inject(ENV) private readonly env: Env,
  ) {
    this.dataDir = path.resolve(env.DATA_DIR);
    mkdirSync(path.join(this.dataDir, 'projects'), { recursive: true });
    this.supervisor = new Supervisor(this.dataDir, (slug, instance, code) =>
      this.handleCrash(slug, instance, code),
    );
  }

  // ── Public API ───────────────────────────────────────────────────────

  async deploy(
    slug: string,
    trigger: 'MANUAL' | 'BOOT' = 'MANUAL',
  ): Promise<DeploymentView> {
    const project = await this.findProject(slug);
    if (project.archivedAt) {
      throw new AppError(
        HttpStatus.CONFLICT,
        'PROJECT_ARCHIVED',
        'Restore the project before deploying.',
      );
    }
    const active = await this.prisma.client.deployment.findFirst({
      where: { projectId: project.id, status: { in: ACTIVE } },
    });
    if (active) {
      throw new AppError(
        HttpStatus.CONFLICT,
        'DEPLOY_IN_PROGRESS',
        'A deployment for this project is already queued or running.',
        { deploymentId: active.id },
      );
    }
    const deployment = await this.prisma.client.deployment.create({
      data: { projectId: project.id, branch: project.branch, trigger },
    });
    await this.prisma.client.project.update({
      where: { id: project.id },
      data: {
        desiredState: 'RUNNING',
        ...(this.supervisor.liveInstance(slug) ? {} : { status: 'QUEUED' }),
      },
    });
    if (trigger === 'MANUAL') {
      await this.activity.record({
        action: 'project.deploy_requested',
        status: 'SUCCESS',
        targetType: 'Project',
        targetId: project.id,
        safeMetadata: { slug, deploymentId: deployment.id },
      });
    }
    const controller = new AbortController();
    this.controllers.set(deployment.id, controller);
    this.queue.push(() => this.runDeployment(deployment.id, controller.signal));
    return toDeploymentView(deployment, false);
  }

  async cancel(deploymentId: string): Promise<DeploymentView> {
    const d = await this.prisma.client.deployment.findUnique({
      where: { id: deploymentId },
    });
    if (!d)
      throw new AppError(
        HttpStatus.NOT_FOUND,
        'DEPLOYMENT_NOT_FOUND',
        'Deployment not found.',
      );
    if (!ACTIVE.includes(d.status)) {
      throw new AppError(
        HttpStatus.CONFLICT,
        'NOT_CANCELLABLE',
        'This deployment has already finished.',
      );
    }
    this.controllers.get(deploymentId)?.abort();
    if (d.status === 'QUEUED') {
      await this.finish(d.id, 'CANCELLED', 'Cancelled before it started.');
      await this.settleProjectStatus(d.projectId);
    }
    return this.getDeployment(deploymentId, false);
  }

  async stop(slug: string): Promise<void> {
    const project = await this.findProject(slug);
    this.clearRestartTimer(slug);
    for (const d of await this.prisma.client.deployment.findMany({
      where: { projectId: project.id, status: { in: ACTIVE } },
      select: { id: true },
    })) {
      this.controllers.get(d.id)?.abort();
    }
    await this.supervisor.stop(slug);
    this.onLiveChange?.(slug);
    await this.prisma.client.deployment.updateMany({
      where: { projectId: project.id, status: 'LIVE' },
      data: { status: 'STOPPED', finishedAt: new Date() },
    });
    await this.prisma.client.project.update({
      where: { id: project.id },
      data: { desiredState: 'STOPPED', status: 'STOPPED' },
    });
  }

  /** Restarts the current build without rebuilding (new process, blue/green). */
  async restart(slug: string): Promise<void> {
    const project = await this.findProject(slug);
    const liveDeployment = await this.prisma.client.deployment.findFirst({
      where: { projectId: project.id, status: { in: ['LIVE', 'STOPPED'] } },
      orderBy: { queuedAt: 'desc' },
    });
    const ready = liveDeployment
      ? this.readReady(project.slug, liveDeployment.id)
      : null;
    if (!liveDeployment || !ready) {
      throw new AppError(
        HttpStatus.CONFLICT,
        'NOTHING_TO_RESTART',
        'There is no built version to restart. Deploy first.',
      );
    }
    this.clearRestartTimer(slug);
    const result = await this.startBuild(project, liveDeployment.id, ready);
    if (!result.ok) {
      throw new AppError(HttpStatus.CONFLICT, 'RESTART_FAILED', result.reason);
    }
    await this.prisma.client.deployment.update({
      where: { id: liveDeployment.id },
      data: { status: 'LIVE' },
    });
    await this.prisma.client.project.update({
      where: { id: project.id },
      data: { desiredState: 'RUNNING', status: 'RUNNING' },
    });
  }

  async listDeployments(slug: string): Promise<DeploymentView[]> {
    const project = await this.findProject(slug);
    const rows = await this.prisma.client.deployment.findMany({
      where: { projectId: project.id },
      orderBy: { queuedAt: 'desc' },
      take: 30,
    });
    return rows.map((r) => toDeploymentView(r, false));
  }

  async getDeployment(id: string, withLog = true): Promise<DeploymentView> {
    const row = await this.prisma.client.deployment.findUnique({
      where: { id },
    });
    if (!row)
      throw new AppError(
        HttpStatus.NOT_FOUND,
        'DEPLOYMENT_NOT_FOUND',
        'Deployment not found.',
      );
    return toDeploymentView(row, withLog);
  }

  runtimeLogs(slug: string, after: number): RuntimeLogPage {
    const log = this.supervisor.logOf(slug);
    return { lines: log.since(after), lastSeq: log.lastSeq };
  }

  livePort(slug: string): number | null {
    return this.supervisor.livePort(slug);
  }

  /** Stops a project and removes its checkouts (archive / delete). */
  async teardown(slug: string, removeFiles: boolean): Promise<void> {
    await this.stop(slug).catch(() => undefined);
    await this.onTeardown?.(slug);
    if (removeFiles) await removeDir(path.join(this.dataDir, 'projects', slug));
  }

  // ── Pipeline ─────────────────────────────────────────────────────────

  private async runDeployment(
    deploymentId: string,
    signal: AbortSignal,
  ): Promise<void> {
    const log = new BoundedText();
    const flush = setInterval(
      () => void this.saveLog(deploymentId, log),
      2_000,
    );
    let project: Project | null = null;
    try {
      const deployment = await this.prisma.client.deployment.findUniqueOrThrow({
        where: { id: deploymentId },
        include: { project: true },
      });
      project = deployment.project;
      if (deployment.status !== 'QUEUED' || signal.aborted) return;
      if (project.archivedAt) throw new StepFailed('The project was archived.');

      const projectEnv = await this.decryptEnv(project.id);
      const dbUrl = await this.databases.connectionUrl(project.id);
      const redactor = new Redactor([
        ...Object.values(projectEnv),
        ...(dbUrl ? [dbUrl] : []),
      ]);
      const say = (text: string) => log.append(`▸ ${text}`);
      const out = (_: string, line: string) =>
        log.append(redactor.redact(line));

      // 1. Clone
      await this.setStatus(deployment.id, project, 'CLONING', {
        startedAt: new Date(),
      });
      const workDir = path.join(
        this.dataDir,
        'projects',
        project.slug,
        deployment.id,
      );
      const repoDir = path.join(workDir, 'src');
      await removeDir(workDir);
      mkdirSync(workDir, { recursive: true });
      say(`Cloning ${project.repoUrl} (branch ${project.branch})`);
      const commit = await shallowClone({
        repoUrl: project.repoUrl,
        branch: project.branch,
        dir: repoDir,
        home: path.join(this.dataDir, 'home', '_git'),
        allowLocal: this.env.RUNNER_ALLOW_LOCAL_REPOS,
        timeoutMs: 120_000,
        onLine: (line) => log.append(line),
        signal,
      }).catch((e: unknown) => {
        throw new StepFailed(e instanceof Error ? e.message : 'Clone failed.');
      });
      await this.prisma.client.deployment.update({
        where: { id: deployment.id },
        data: { commitSha: commit.sha, commitMessage: commit.message },
      });
      say(`Commit ${commit.sha.slice(0, 7)}: ${commit.message}`);
      const size = await dirSizeBytes(
        repoDir,
        this.env.MAX_REPO_SIZE_MB * 1024 * 1024,
      );
      if (size > this.env.MAX_REPO_SIZE_MB * 1024 * 1024) {
        throw new StepFailed(
          `The repository is larger than ${this.env.MAX_REPO_SIZE_MB} MB.`,
        );
      }

      // 2. Plan
      const appDir = await resolveInside(repoDir, project.rootDir).catch(
        (e: Error) => {
          throw new StepFailed(e.message);
        },
      );
      let plan: Plan;
      try {
        plan = planBuild(appDir, project);
      } catch (e) {
        throw new StepFailed(
          e instanceof DetectionError ? e.message : 'Could not plan the build.',
        );
      }
      await this.prisma.client.deployment.update({
        where: { id: deployment.id },
        data: { runtime: plan.runtime },
      });
      say(`Language: ${plan.runtime}`);
      for (const note of plan.notes) say(note);

      const buildEnv = buildProjectEnv({
        dataDir: this.dataDir,
        slug: project.slug,
        projectEnv,
        pathPrefix: plan.pathPrefix,
      });
      mkdirSync(buildEnv.HOME!, { recursive: true });
      mkdirSync(buildEnv.TMPDIR!, { recursive: true });

      // 3. Install & build
      for (const [status, command] of [
        ['INSTALLING', plan.install],
        ['BUILDING', plan.build],
      ] as const) {
        if (!command) continue;
        await this.setStatus(deployment.id, project, status);
        say(`$ ${command}`);
        const res = await runCommand({
          command,
          cwd: appDir,
          env: buildEnv,
          timeoutMs: this.env.BUILD_STEP_TIMEOUT_SECONDS * 1000,
          onLine: out,
          signal,
        });
        if (res.aborted) throw new StepFailed('Cancelled.');
        if (res.timedOut) {
          throw new StepFailed(
            `"${command}" took longer than ${this.env.BUILD_STEP_TIMEOUT_SECONDS}s.`,
          );
        }
        if (res.exitCode !== 0) {
          throw new StepFailed(
            `"${command}" failed with exit code ${res.exitCode ?? res.signal}.`,
          );
        }
      }
      const ready: ReadyInfo = { appDir, plan };
      writeFileSync(path.join(workDir, READY_MARKER), JSON.stringify(ready));

      // 4. Start (blue/green)
      await this.setStatus(deployment.id, project, 'STARTING');
      say(`$ ${plan.start}`);
      const started = await this.startBuild(
        project,
        deployment.id,
        ready,
        signal,
      );
      if (!started.ok) throw new StepFailed(started.reason);

      // 5. Live
      await this.prisma.client.deployment.updateMany({
        where: {
          projectId: project.id,
          status: 'LIVE',
          id: { not: deployment.id },
        },
        data: { status: 'SUPERSEDED' },
      });
      say('Live.');
      await this.finish(deployment.id, 'LIVE', null, log);
      await this.prisma.client.project.update({
        where: { id: project.id },
        data: {
          status: 'RUNNING',
          lastCommitSha: commit.sha,
          lastDeployedAt: new Date(),
        },
      });
      this.crashTimes.delete(project.slug);
      await this.activity.record({
        action: 'project.deployed',
        status: 'SUCCESS',
        targetType: 'Project',
        targetId: project.id,
        safeMetadata: {
          slug: project.slug,
          commit: commit.sha.slice(0, 7),
          runtime: plan.runtime,
        },
      });
      await this.cleanupOldBuilds(project.slug, project.id);
    } catch (error) {
      const reason =
        error instanceof StepFailed
          ? error.message
          : (this.logger.error(
              `Deployment ${deploymentId} crashed: ${(error as Error).message}`,
            ),
            'Unexpected error while deploying.');
      log.append(`✖ ${reason}`);
      const cancelled = signal.aborted;
      await this.finish(
        deploymentId,
        cancelled ? 'CANCELLED' : 'FAILED',
        reason,
        log,
      );
      if (project) {
        await this.settleProjectStatus(project.id);
        if (!cancelled) {
          await this.activity.record({
            action: 'project.deployed',
            status: 'FAILURE',
            targetType: 'Project',
            targetId: project.id,
            safeMetadata: { slug: project.slug, reason: reason.slice(0, 200) },
          });
        }
      }
    } finally {
      clearInterval(flush);
      this.controllers.delete(deploymentId);
    }
  }

  private async startBuild(
    project: Project,
    deploymentId: string,
    ready: ReadyInfo,
    signal?: AbortSignal,
  ): Promise<{ ok: true } | { ok: false; reason: string }> {
    const isReplacement = Boolean(this.supervisor.liveInstance(project.slug));
    if (
      !isReplacement &&
      this.supervisor.liveCount() >= this.env.MAX_RUNNING_PROJECTS
    ) {
      return {
        ok: false,
        reason: `Already running ${this.env.MAX_RUNNING_PROJECTS} projects (MAX_RUNNING_PROJECTS). Stop one first.`,
      };
    }
    let slot = this.supervisor.nextSlot(project.slug);
    let port = privatePort(project.publicPort, slot);
    if (!(await portFree(port))) {
      const other = (slot === 0 ? 1 : 0) as 0 | 1;
      if (
        !isReplacement &&
        (await portFree(privatePort(project.publicPort, other)))
      ) {
        slot = other;
        port = privatePort(project.publicPort, other);
      } else {
        return {
          ok: false,
          reason: `Internal port ${port} is busy. Try again in a moment.`,
        };
      }
    }

    const projectEnv = await this.decryptEnv(project.id);
    const dbUrl = await this.databases.connectionUrl(project.id);
    const env = buildProjectEnv({
      dataDir: this.dataDir,
      slug: project.slug,
      projectEnv,
      pathPrefix: ready.plan.pathPrefix,
      runtime: {
        port,
        basePath: `/apps/${project.slug}`,
        memoryMb: this.env.PROJECT_MEMORY_MB,
        databaseUrl: dbUrl ?? undefined,
      },
    });
    mkdirSync(env.HOME!, { recursive: true });
    mkdirSync(env.TMPDIR!, { recursive: true });

    const spec: StartSpec = {
      slug: project.slug,
      deploymentId,
      slot,
      port,
      publicPort: project.publicPort,
      appDir: ready.appDir,
      command: ready.plan.start,
      env,
      healthPath: project.healthCheckPath,
      redactor: new Redactor([
        ...Object.values(projectEnv),
        ...(dbUrl ? [dbUrl] : []),
      ]),
    };
    const result = await this.supervisor.startAndPromote(
      spec,
      this.env.START_TIMEOUT_SECONDS * 1000,
      signal,
    );
    if (result.ok) this.onLiveChange?.(project.slug);
    return result;
  }

  // ── Crash policy ─────────────────────────────────────────────────────

  private handleCrash(
    slug: string,
    instance: Instance,
    code: number | null,
  ): void {
    this.onLiveChange?.(slug);
    if (this.shuttingDown) return;
    const now = Date.now();
    const recent = (this.crashTimes.get(slug) ?? []).filter(
      (t) => now - t < CRASH_WINDOW_MS,
    );
    recent.push(now);
    this.crashTimes.set(slug, recent);
    const log = this.supervisor.logOf(slug);

    void (async () => {
      const project = await this.prisma.client.project.findUnique({
        where: { slug },
      });
      if (!project || project.desiredState !== 'RUNNING' || project.archivedAt)
        return;

      if (recent.length > MAX_CRASH_RESTARTS) {
        log.push(
          'system',
          `Crashed ${recent.length} times in 10 minutes. Giving up; deploy or restart manually.`,
        );
        await this.prisma.client.project.update({
          where: { id: project.id },
          data: { status: 'CRASHED' },
        });
        await this.activity.record({
          action: 'project.crashed',
          status: 'FAILURE',
          targetType: 'Project',
          targetId: project.id,
          safeMetadata: { slug, exitCode: code, restarts: recent.length - 1 },
        });
        return;
      }
      const delay = Math.min(1_000 * 2 ** (recent.length - 1), 60_000);
      log.push(
        'system',
        `Restarting in ${Math.round(delay / 1000)}s (attempt ${recent.length}).`,
      );
      await this.prisma.client.project.update({
        where: { id: project.id },
        data: { status: 'STARTING' },
      });
      this.restartTimers.set(
        slug,
        setTimeout(() => {
          this.restartTimers.delete(slug);
          void this.restartAfterCrash(project, instance.spec.deploymentId);
        }, delay),
      );
    })();
  }

  private async restartAfterCrash(
    project: Project,
    deploymentId: string,
  ): Promise<void> {
    const fresh = await this.prisma.client.project.findUnique({
      where: { id: project.id },
    });
    if (
      !fresh ||
      fresh.desiredState !== 'RUNNING' ||
      this.supervisor.liveInstance(fresh.slug)
    )
      return;
    const ready = this.readReady(fresh.slug, deploymentId);
    if (!ready) return;
    const result = await this.startBuild(fresh, deploymentId, ready);
    await this.prisma.client.project.update({
      where: { id: fresh.id },
      data: { status: result.ok ? 'RUNNING' : 'CRASHED' },
    });
    if (!result.ok) {
      // A failed start counts as another crash.
      this.handleCrash(
        fresh.slug,
        { spec: { deploymentId } } as Instance,
        null,
      );
    }
  }

  private clearRestartTimer(slug: string): void {
    const t = this.restartTimers.get(slug);
    if (t) clearTimeout(t);
    this.restartTimers.delete(slug);
  }

  // ── Boot & shutdown ──────────────────────────────────────────────────

  async onApplicationBootstrap(): Promise<void> {
    const killed = await this.supervisor.killOrphans();
    if (killed)
      this.logger.warn(`Cleaned up ${killed} leftover project process(es).`);

    // Anything "in progress" from a previous run was interrupted.
    await this.prisma.client.deployment.updateMany({
      where: { status: { in: ACTIVE } },
      data: {
        status: 'FAILED',
        errorSummary: 'Interrupted because StackDock restarted.',
        finishedAt: new Date(),
      },
    });
    await this.prisma.client.deployment.updateMany({
      where: { status: 'LIVE' },
      data: { status: 'STOPPED' },
    });
    if (!this.env.RUNNER_AUTOSTART) return;
    void this.restoreRunningProjects();
  }

  /** Starts every project that should be running: reuse an existing build if present, else rebuild. */
  async restoreRunningProjects(): Promise<void> {
    const projects = await this.prisma.client.project.findMany({
      where: { desiredState: 'RUNNING', archivedAt: null },
      orderBy: { createdAt: 'asc' },
    });
    for (const project of projects) {
      const last = await this.prisma.client.deployment.findFirst({
        where: {
          projectId: project.id,
          status: { in: ['STOPPED', 'SUPERSEDED'] },
          commitSha: { not: null },
        },
        orderBy: { queuedAt: 'desc' },
      });
      const ready = last ? this.readReady(project.slug, last.id) : null;
      if (last && ready) {
        this.supervisor
          .logOf(project.slug)
          .push('system', 'StackDock restarted; starting the existing build.');
        const result = await this.startBuild(project, last.id, ready);
        if (result.ok) {
          await this.prisma.client.deployment.update({
            where: { id: last.id },
            data: { status: 'LIVE' },
          });
          await this.prisma.client.project.update({
            where: { id: project.id },
            data: { status: 'RUNNING' },
          });
          continue;
        }
      }
      // No usable build on disk (e.g. Northflank wiped it): rebuild.
      await this.deploy(project.slug, 'BOOT').catch((e: Error) =>
        this.logger.warn(
          `Could not queue boot deploy for ${project.slug}: ${e.message}`,
        ),
      );
    }
  }

  async onApplicationShutdown(): Promise<void> {
    this.shuttingDown = true;
    for (const c of this.controllers.values()) c.abort();
    for (const timer of this.restartTimers.values()) clearTimeout(timer);
    this.restartTimers.clear();
    await this.supervisor.stopAll(5_000);
  }

  /** Test helper: wait for queued deployments to finish. */
  idle(): Promise<void> {
    return this.queue.idle();
  }

  // ── Helpers ──────────────────────────────────────────────────────────

  private async findProject(slug: string): Promise<Project> {
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

  private async decryptEnv(projectId: string): Promise<Record<string, string>> {
    const rows = await this.prisma.client.projectEnvVar.findMany({
      where: { projectId },
    });
    try {
      return Object.fromEntries(
        rows.map((r) => [
          r.key,
          this.encryption.decrypt(
            r.encryptedValue,
            envVarContext(projectId, r.key),
          ),
        ]),
      );
    } catch {
      throw new StepFailed(
        'An environment variable could not be decrypted (encryption key changed?). Re-enter it.',
      );
    }
  }

  private async setStatus(
    deploymentId: string,
    project: Project,
    status: DeploymentStatus,
    extra: { startedAt?: Date } = {},
  ): Promise<void> {
    await this.prisma.client.deployment.update({
      where: { id: deploymentId },
      data: { status, ...extra },
    });
    if (!this.supervisor.liveInstance(project.slug)) {
      const projectStatus = status === 'STARTING' ? 'STARTING' : 'BUILDING';
      await this.prisma.client.project.update({
        where: { id: project.id },
        data: { status: projectStatus },
      });
    }
  }

  private async finish(
    deploymentId: string,
    status: DeploymentStatus,
    errorSummary: string | null,
    log?: BoundedText,
  ): Promise<void> {
    await this.prisma.client.deployment.update({
      where: { id: deploymentId },
      data: {
        status,
        errorSummary,
        finishedAt: new Date(),
        ...(log ? { log: log.toString() } : {}),
      },
    });
  }

  private async saveLog(deploymentId: string, log: BoundedText): Promise<void> {
    await this.prisma.client.deployment
      .update({ where: { id: deploymentId }, data: { log: log.toString() } })
      .catch(() => undefined);
  }

  /** After a failed/cancelled deploy: RUNNING if an older version still serves, else FAILED/STOPPED. */
  private async settleProjectStatus(projectId: string): Promise<void> {
    const project = await this.prisma.client.project.findUnique({
      where: { id: projectId },
    });
    if (!project) return;
    const running = Boolean(this.supervisor.liveInstance(project.slug));
    await this.prisma.client.project.update({
      where: { id: projectId },
      data: {
        status: running
          ? 'RUNNING'
          : project.desiredState === 'STOPPED'
            ? 'STOPPED'
            : 'FAILED',
      },
    });
  }

  private readReady(slug: string, deploymentId: string): ReadyInfo | null {
    const file = path.join(
      this.dataDir,
      'projects',
      slug,
      deploymentId,
      READY_MARKER,
    );
    if (!existsSync(file)) return null;
    try {
      const ready = JSON.parse(readFileSync(file, 'utf8')) as ReadyInfo;
      return existsSync(ready.appDir) ? ready : null;
    } catch {
      return null;
    }
  }

  /** Keep only the live build and the newest other build on disk. */
  private async cleanupOldBuilds(
    slug: string,
    projectId: string,
  ): Promise<void> {
    const dir = path.join(this.dataDir, 'projects', slug);
    if (!existsSync(dir)) return;
    const keep = new Set(
      (
        await this.prisma.client.deployment.findMany({
          where: {
            projectId,
            status: { in: [...ACTIVE, 'LIVE', 'STOPPED', 'SUPERSEDED'] },
          },
          orderBy: { queuedAt: 'desc' },
          take: 2,
          select: { id: true },
        })
      ).map((d) => d.id),
    );
    for (const entry of readdirSync(dir)) {
      if (!keep.has(entry)) await removeDir(path.join(dir, entry));
    }
  }
}

function toDeploymentView(
  row: {
    id: string;
    projectId: string;
    status: DeploymentStatus;
    trigger: 'MANUAL' | 'BOOT';
    branch: string;
    commitSha: string | null;
    commitMessage: string | null;
    runtime: string | null;
    errorSummary: string | null;
    log: string;
    queuedAt: Date;
    startedAt: Date | null;
    finishedAt: Date | null;
  },
  withLog: boolean,
): DeploymentView {
  return {
    id: row.id,
    projectId: row.projectId,
    status: row.status,
    trigger: row.trigger,
    branch: row.branch,
    commitSha: row.commitSha,
    commitMessage: row.commitMessage,
    runtime: row.runtime as DeploymentView['runtime'],
    errorSummary: row.errorSummary,
    queuedAt: row.queuedAt.toISOString(),
    startedAt: row.startedAt?.toISOString() ?? null,
    finishedAt: row.finishedAt?.toISOString() ?? null,
    ...(withLog ? { log: row.log } : {}),
  };
}

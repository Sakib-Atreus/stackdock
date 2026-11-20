import type { ChildProcess } from 'node:child_process';
import {
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { readlink, realpath } from 'node:fs/promises';
import path from 'node:path';
import { Logger } from '@nestjs/common';
import { RingLog } from './log-buffer.js';
import { killTree, pipeLines, signalGroup, spawnShell } from './process.js';
import type { Redactor } from './redactor.js';
import { waitHealthy } from './health.js';

export interface StartSpec {
  slug: string;
  deploymentId: string;
  slot: 0 | 1;
  port: number;
  /** The project's public port (per-port listener, D-15). */
  publicPort: number;
  appDir: string;
  command: string;
  env: Record<string, string>;
  healthPath: string | null;
  redactor: Redactor;
}

export interface Instance {
  spec: StartSpec;
  child: ChildProcess;
  startedAt: Date;
  stopping: boolean;
}

export type CrashHandler = (
  slug: string,
  instance: Instance,
  code: number | null,
) => void;

/**
 * Owns the OS processes of running projects: start, health-check, swap
 * (blue/green), stop, crash detection and runtime logs. Knows nothing about
 * the database; RunnerService handles persistence and policy.
 */
export class Supervisor {
  private readonly logger = new Logger('Supervisor');
  private readonly live = new Map<string, Instance>();
  private readonly logs = new Map<string, RingLog>();
  private readonly runDir: string;

  constructor(
    dataDir: string,
    private readonly onCrash: CrashHandler,
  ) {
    this.runDir = path.join(dataDir, 'run');
    mkdirSync(this.runDir, { recursive: true });
  }

  logOf(slug: string): RingLog {
    let log = this.logs.get(slug);
    if (!log) {
      log = new RingLog(1_000);
      this.logs.set(slug, log);
    }
    return log;
  }

  liveInstance(slug: string): Instance | undefined {
    return this.live.get(slug);
  }

  livePublicPort(slug: string): number | null {
    return this.live.get(slug)?.spec.publicPort ?? null;
  }

  livePort(slug: string): number | null {
    return this.live.get(slug)?.spec.port ?? null;
  }

  liveCount(): number {
    return this.live.size;
  }

  /** The slot a new version should use (the one not used by the live instance). */
  nextSlot(slug: string): 0 | 1 {
    return this.live.get(slug)?.spec.slot === 0 ? 1 : 0;
  }

  /**
   * Starts a candidate and waits until healthy. On success it becomes the live
   * instance and the previous one is stopped. On failure the candidate is
   * killed and the previous instance keeps serving.
   */
  async startAndPromote(
    spec: StartSpec,
    timeoutMs: number,
    signal?: AbortSignal,
  ): Promise<{ ok: true } | { ok: false; reason: string }> {
    const log = this.logOf(spec.slug);
    log.push('system', `Starting: ${spec.command} (port ${spec.port})`);
    const instance = this.spawn(spec);
    try {
      return await this.promoteWhenHealthy(instance, timeoutMs, signal);
    } catch (error) {
      // Never leave an orphaned process behind on an unexpected error.
      instance.stopping = true;
      if (this.live.get(spec.slug) === instance) this.live.delete(spec.slug);
      await killTree(instance.child, 3_000);
      this.removePid(spec.slug, spec.slot);
      throw error;
    }
  }

  private async promoteWhenHealthy(
    instance: Instance,
    timeoutMs: number,
    signal?: AbortSignal,
  ): Promise<{ ok: true } | { ok: false; reason: string }> {
    const { spec } = instance;
    const log = this.logOf(spec.slug);
    const result = await waitHealthy({
      port: spec.port,
      healthPath: spec.healthPath,
      timeoutMs,
      isAlive: () =>
        instance.child.exitCode === null && instance.child.signalCode === null,
      signal,
    });
    if (result !== 'healthy') {
      instance.stopping = true;
      await killTree(instance.child, 3_000);
      this.removePid(spec.slug, spec.slot);
      const reason =
        result === 'exited'
          ? `The app exited during startup (code ${instance.child.exitCode ?? instance.child.signalCode}). See the logs.`
          : result === 'aborted'
            ? 'Cancelled.'
            : spec.healthPath
              ? `The health check ${spec.healthPath} did not succeed within ${Math.round(timeoutMs / 1000)}s. Make sure the app listens on $PORT.`
              : `The app did not open port $PORT within ${Math.round(timeoutMs / 1000)}s. Make sure it listens on the PORT environment variable.`;
      log.push('system', `Start failed: ${reason}`);
      return { ok: false, reason };
    }

    const previous = this.live.get(spec.slug);
    this.live.set(spec.slug, instance);
    log.push('system', `Healthy. Now serving deployment ${spec.deploymentId}.`);
    if (previous) {
      previous.stopping = true;
      log.push('system', 'Stopping the previous version.');
      void killTree(previous.child).then(() =>
        this.removePid(spec.slug, previous.spec.slot),
      );
    }
    return { ok: true };
  }

  async stop(slug: string, graceMs = 10_000): Promise<void> {
    const instance = this.live.get(slug);
    if (!instance) return;
    this.live.delete(slug);
    instance.stopping = true;
    this.logOf(slug).push('system', 'Stopping.');
    await killTree(instance.child, graceMs);
    this.removePid(slug, instance.spec.slot);
  }

  async stopAll(graceMs = 5_000): Promise<void> {
    await Promise.all(
      [...this.live.keys()].map((slug) => this.stop(slug, graceMs)),
    );
  }

  private spawn(spec: StartSpec): Instance {
    const child = spawnShell(spec.command, spec.appDir, spec.env);
    const instance: Instance = {
      spec,
      child,
      startedAt: new Date(),
      stopping: false,
    };
    const log = this.logOf(spec.slug);
    pipeLines(child, (stream, line) =>
      log.push(stream, spec.redactor.redact(line)),
    );
    child.on('error', (error) =>
      log.push('system', `Process error: ${error.message}`),
    );
    if (child.pid) this.writePid(spec.slug, spec.slot, child.pid, spec.appDir);

    child.on('exit', (code, sig) => {
      if (instance.stopping) return;
      log.push('system', `Process exited (${code ?? sig}).`);
      if (this.live.get(spec.slug) === instance) {
        this.live.delete(spec.slug);
        this.removePid(spec.slug, spec.slot);
        this.onCrash(spec.slug, instance, code);
      }
    });
    return instance;
  }

  // ── Orphan handling (e.g. StackDock was killed without a clean shutdown) ──

  private pidFile(slug: string, slot: number): string {
    return path.join(this.runDir, `${slug}.${slot}.pid`);
  }

  private writePid(
    slug: string,
    slot: number,
    pid: number,
    appDir: string,
  ): void {
    // Best effort: a missing/cleared data dir must never break a deployment.
    try {
      mkdirSync(this.runDir, { recursive: true });
      writeFileSync(this.pidFile(slug, slot), JSON.stringify({ pid, appDir }));
    } catch (error) {
      this.logger.warn(
        `Could not write pid file for ${slug}: ${(error as Error).message}`,
      );
    }
  }

  private removePid(slug: string, slot: number): void {
    rmSync(this.pidFile(slug, slot), { force: true });
  }

  /**
   * Kills process groups left over from a previous StackDock run. Only kills a
   * PID if its working directory is still the project's checkout (guards
   * against PID reuse). Where cwd can't be read, the PID is left alone.
   */
  async killOrphans(): Promise<number> {
    let killed = 0;
    mkdirSync(this.runDir, { recursive: true });
    for (const file of readdirSync(this.runDir).filter((f) =>
      f.endsWith('.pid'),
    )) {
      const full = path.join(this.runDir, file);
      try {
        const { pid, appDir } = JSON.parse(readFileSync(full, 'utf8')) as {
          pid: number;
          appDir: string;
        };
        const cwd = await processCwd(pid);
        if (cwd && (await samePath(cwd, appDir))) {
          signalGroup(pid, 'SIGKILL');
          killed += 1;
          this.logger.warn(`Killed leftover process group ${pid} (${file})`);
        }
      } catch {
        /* unreadable pid file */
      }
      rmSync(full, { force: true });
    }
    return killed;
  }
}

/** Compares real paths (macOS /var is a symlink to /private/var). */
async function samePath(a: string, b: string): Promise<boolean> {
  const real = (p: string) => realpath(p).catch(() => path.resolve(p));
  return (await real(a)) === (await real(b));
}

async function processCwd(pid: number): Promise<string | null> {
  try {
    process.kill(pid, 0);
  } catch {
    return null; // not running
  }
  if (process.platform === 'linux') {
    return readlink(`/proc/${pid}/cwd`).catch(() => null);
  }
  if (process.platform === 'darwin') {
    const { execFile } = await import('node:child_process');
    return new Promise((resolve) => {
      execFile(
        'lsof',
        ['-a', '-p', String(pid), '-d', 'cwd', '-Fn'],
        (err, stdout) => {
          if (err) return resolve(null);
          const line = stdout.split('\n').find((l) => l.startsWith('n'));
          resolve(line ? line.slice(1) : null);
        },
      );
    });
  }
  return null;
}

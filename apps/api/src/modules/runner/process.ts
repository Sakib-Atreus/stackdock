import { type ChildProcess, spawn } from 'node:child_process';
import { createInterface } from 'node:readline';

export interface RunOptions {
  command: string;
  cwd: string;
  env: Record<string, string>;
  timeoutMs: number;
  onLine: (stream: 'stdout' | 'stderr', line: string) => void;
  signal?: AbortSignal;
}

export interface RunResult {
  exitCode: number | null;
  signal: NodeJS.Signals | null;
  timedOut: boolean;
  aborted: boolean;
}

/**
 * Spawns `/bin/sh -c <command>` in its own process group (so the whole tree
 * can be killed) with an explicit environment: nothing is inherited from
 * StackDock's own process.env.
 */
export function spawnShell(
  command: string,
  cwd: string,
  env: Record<string, string>,
): ChildProcess {
  return spawn('/bin/sh', ['-c', command], {
    cwd,
    env,
    detached: true,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
}

export function pipeLines(
  child: ChildProcess,
  onLine: (stream: 'stdout' | 'stderr', line: string) => void,
): void {
  for (const stream of ['stdout', 'stderr'] as const) {
    const source = child[stream];
    if (!source) continue;
    createInterface({ input: source, crlfDelay: Infinity }).on('line', (line) =>
      onLine(stream, line),
    );
  }
}

/** SIGTERM the process group, then SIGKILL after `graceMs`. */
export async function killTree(
  child: ChildProcess,
  graceMs = 10_000,
): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null || !child.pid)
    return;
  const exited = new Promise<void>((resolve) =>
    child.once('exit', () => resolve()),
  );
  signalGroup(child.pid, 'SIGTERM');
  const timer = setTimeout(() => signalGroup(child.pid!, 'SIGKILL'), graceMs);
  await exited;
  clearTimeout(timer);
}

export function signalGroup(pid: number, signal: NodeJS.Signals): void {
  try {
    process.kill(-pid, signal);
  } catch {
    try {
      process.kill(pid, signal);
    } catch {
      /* already gone */
    }
  }
}

/** Runs a build step to completion with a timeout and optional cancellation. */
export function runCommand(options: RunOptions): Promise<RunResult> {
  return new Promise((resolve) => {
    const child = spawnShell(options.command, options.cwd, options.env);
    let timedOut = false;
    let aborted = false;
    pipeLines(child, options.onLine);

    const timer = setTimeout(() => {
      timedOut = true;
      void killTree(child, 5_000);
    }, options.timeoutMs);
    const onAbort = () => {
      aborted = true;
      void killTree(child, 5_000);
    };
    options.signal?.addEventListener('abort', onAbort, { once: true });

    child.on('error', (error) => {
      options.onLine('stderr', `Failed to start: ${error.message}`);
    });
    child.on('close', (exitCode, signal) => {
      clearTimeout(timer);
      options.signal?.removeEventListener('abort', onAbort);
      resolve({ exitCode, signal, timedOut, aborted });
    });
  });
}

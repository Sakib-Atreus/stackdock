import { mkdirSync } from 'node:fs';
import { runCommand } from './process.js';

export interface CloneResult {
  sha: string;
  message: string;
}

export class CloneError extends Error {}

const GITHUB = /^https:\/\/github\.com\/[A-Za-z0-9-]+\/[A-Za-z0-9._-]+$/;

/**
 * Shallow-clones one branch. Hardened: no prompts, no user/system git config
 * (no credential helpers), no hooks, no submodules, only https (or file://
 * when explicitly allowed for tests).
 */
export async function shallowClone(options: {
  repoUrl: string;
  branch: string;
  dir: string;
  home: string;
  allowLocal: boolean;
  timeoutMs: number;
  onLine: (line: string) => void;
  signal?: AbortSignal;
}): Promise<CloneResult> {
  const isLocal = options.repoUrl.startsWith('file://');
  if (!(GITHUB.test(options.repoUrl) || (isLocal && options.allowLocal))) {
    throw new CloneError('Repository URL is not an allowed public GitHub URL.');
  }
  if (options.branch.startsWith('-'))
    throw new CloneError('Invalid branch name.');
  mkdirSync(options.home, { recursive: true });

  const env = {
    PATH: process.env.PATH ?? '/usr/local/bin:/usr/bin:/bin',
    HOME: options.home,
    GIT_TERMINAL_PROMPT: '0',
    GIT_ASKPASS: '/bin/false',
    GIT_CONFIG_NOSYSTEM: '1',
    GIT_CONFIG_GLOBAL: '/dev/null',
    GIT_LFS_SKIP_SMUDGE: '1',
    LANG: 'C.UTF-8',
  };
  const protocols = isLocal
    ? '-c protocol.allow=never -c protocol.file.allow=always'
    : '-c protocol.allow=never -c protocol.https.allow=always';
  const q = (s: string) => `'${s.replace(/'/g, `'\\''`)}'`;

  const clone = await runCommand({
    command: `git ${protocols} -c core.hooksPath=/dev/null -c advice.detachedHead=false clone --depth 1 --single-branch --no-tags --branch ${q(options.branch)} -- ${q(options.repoUrl)} ${q(options.dir)}`,
    cwd: options.home,
    env,
    timeoutMs: options.timeoutMs,
    onLine: (_, line) => options.onLine(line),
    signal: options.signal,
  });
  if (clone.aborted) throw new CloneError('Cancelled.');
  if (clone.timedOut) throw new CloneError('Cloning timed out.');
  if (clone.exitCode !== 0) {
    throw new CloneError(
      'Could not clone the repository. Check that it is public and the branch exists.',
    );
  }

  const lines: string[] = [];
  const info = await runCommand({
    command: 'git log -1 --format=%H%n%s',
    cwd: options.dir,
    env,
    timeoutMs: 15_000,
    onLine: (stream, line) => stream === 'stdout' && lines.push(line),
  });
  if (info.exitCode !== 0 || !/^[0-9a-f]{40}$/.test(lines[0] ?? '')) {
    throw new CloneError('Could not read the cloned commit.');
  }
  return { sha: lines[0]!, message: (lines[1] ?? '').slice(0, 200) };
}

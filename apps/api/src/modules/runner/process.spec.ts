import { tmpdir } from 'node:os';
import { runCommand } from './process.js';

const env = { PATH: process.env.PATH ?? '/usr/bin:/bin' };

describe('runCommand', () => {
  it('captures stdout/stderr lines and the exit code', async () => {
    const lines: string[] = [];
    const result = await runCommand({
      command: 'echo hello; echo oops 1>&2; exit 3',
      cwd: tmpdir(),
      env,
      timeoutMs: 5_000,
      onLine: (stream, line) => lines.push(`${stream}:${line}`),
    });
    expect(result).toMatchObject({ exitCode: 3, timedOut: false });
    expect(lines).toEqual(
      expect.arrayContaining(['stdout:hello', 'stderr:oops']),
    );
  });

  it('does not inherit the parent environment', async () => {
    process.env.STACKDOCK_TEST_SECRET = 'leaky';
    const lines: string[] = [];
    await runCommand({
      command: 'echo "[$STACKDOCK_TEST_SECRET]"',
      cwd: tmpdir(),
      env,
      timeoutMs: 5_000,
      onLine: (_, l) => lines.push(l),
    });
    delete process.env.STACKDOCK_TEST_SECRET;
    expect(lines).toEqual(['[]']);
  });

  it('kills the whole process tree on timeout', async () => {
    const started = Date.now();
    const result = await runCommand({
      command: 'sleep 30 & sleep 30; wait',
      cwd: tmpdir(),
      env,
      timeoutMs: 300,
      onLine: () => undefined,
    });
    expect(result.timedOut).toBe(true);
    expect(Date.now() - started).toBeLessThan(5_000);
  });

  it('can be cancelled', async () => {
    const controller = new AbortController();
    setTimeout(() => controller.abort(), 200);
    const result = await runCommand({
      command: 'sleep 30',
      cwd: tmpdir(),
      env,
      timeoutMs: 10_000,
      onLine: () => undefined,
      signal: controller.signal,
    });
    expect(result.aborted).toBe(true);
  });
});

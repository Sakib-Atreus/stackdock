import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { portFree, tcpOpen } from './health.js';
import { Redactor } from './redactor.js';
import { type StartSpec, Supervisor } from './supervisor.js';

const SERVER = `node -e "require('http').createServer((q,s)=>s.end(process.env.V)).listen(+process.env.PORT,'127.0.0.1')"`;

function spec(dir: string, port: number, slot: 0 | 1, v: string): StartSpec {
  return {
    slug: 'svtest',
    deploymentId: `d-${v}`,
    slot,
    port,
    publicPort: 10_900,
    appDir: dir,
    command: SERVER,
    env: { PATH: process.env.PATH!, PORT: String(port), V: v },
    healthPath: null,
    redactor: new Redactor([]),
  };
}

describe('Supervisor (real processes)', () => {
  let dir: string;
  let sup: Supervisor;
  const crashes: string[] = [];

  beforeEach(() => {
    dir = mkdtempSync(path.join(tmpdir(), 'sup-'));
    sup = new Supervisor(dir, (slug) => crashes.push(slug));
  });
  afterEach(async () => {
    await sup.stopAll(1_000);
    rmSync(dir, { recursive: true, force: true });
  });

  it('promotes a healthy process and swaps to a new one (blue/green)', async () => {
    expect(
      await sup.startAndPromote(spec(dir, 29_101, 0, 'a'), 10_000),
    ).toEqual({ ok: true });
    expect(sup.livePort('svtest')).toBe(29_101);
    expect(
      await sup.startAndPromote(spec(dir, 29_102, 1, 'b'), 10_000),
    ).toEqual({ ok: true });
    expect(sup.livePort('svtest')).toBe(29_102);
    // The old version is shut down.
    await expect.poll(() => portFree(29_101), { timeout: 5_000 }).toBe(true);
    expect(crashes).toEqual([]);
  });

  it('reports a crash of the live process', async () => {
    await sup.startAndPromote(spec(dir, 29_103, 0, 'a'), 10_000);
    const pid = sup.liveInstance('svtest')!.child.pid!;
    process.kill(-pid, 'SIGKILL');
    await expect.poll(() => crashes.length, { timeout: 5_000 }).toBe(1);
    expect(sup.livePort('svtest')).toBeNull();
  });

  it('kills the process if anything throws during startup (no orphans)', async () => {
    const exploding = new Proxy(new AbortController().signal, {
      get(target, prop) {
        if (prop === 'aborted') throw new Error('boom');
        return Reflect.get(target, prop);
      },
    });
    await expect(
      sup.startAndPromote(spec(dir, 29_104, 0, 'a'), 10_000, exploding),
    ).rejects.toThrow('boom');
    await expect.poll(() => tcpOpen(29_104), { timeout: 5_000 }).toBe(false);
    expect(sup.livePort('svtest')).toBeNull();
  });

  it('a restarted StackDock kills processes left by a crashed one', async () => {
    const appDir = mkdtempSync(path.join(tmpdir(), 'sup-app-'));
    await sup.startAndPromote({ ...spec(dir, 29_106, 0, 'a'), appDir }, 10_000);
    expect(await tcpOpen(29_106)).toBe(true);

    // Simulate StackDock dying without cleanup: a brand-new supervisor on the same data dir.
    const next = new Supervisor(dir, () => undefined);
    expect(await next.killOrphans()).toBe(1);
    await expect.poll(() => tcpOpen(29_106), { timeout: 5_000 }).toBe(false);
    rmSync(appDir, { recursive: true, force: true });
  });

  it('survives its data directory being deleted while running', async () => {
    // Only the data dir disappears; the app's own folder is elsewhere.
    rmSync(dir, { recursive: true, force: true });
    const s = { ...spec(dir, 29_105, 0, 'a'), appDir: tmpdir() };
    expect(await sup.startAndPromote(s, 10_000)).toEqual({ ok: true });
  });
});

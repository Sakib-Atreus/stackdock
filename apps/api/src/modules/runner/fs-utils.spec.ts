import {
  mkdirSync,
  mkdtempSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { dirSizeBytes, resolveInside } from './fs-utils.js';

describe('fs utils', () => {
  let root: string;
  beforeEach(() => {
    root = mkdtempSync(path.join(tmpdir(), 'fsu-'));
    mkdirSync(path.join(root, 'repo/apps/api'), { recursive: true });
    writeFileSync(path.join(root, 'repo/a.txt'), 'x'.repeat(100));
    writeFileSync(path.join(root, 'repo/apps/api/b.txt'), 'y'.repeat(50));
  });
  afterEach(() => rmSync(root, { recursive: true, force: true }));

  it('sums file sizes', async () => {
    expect(await dirSizeBytes(path.join(root, 'repo'))).toBe(150);
  });

  it('resolves folders inside the repo', async () => {
    const repo = path.join(root, 'repo');
    expect(await resolveInside(repo, 'apps/api')).toMatch(/repo\/apps\/api$/);
    expect(await resolveInside(repo, '.')).toMatch(/repo$/);
  });

  it('rejects missing folders and symlink escapes', async () => {
    const repo = path.join(root, 'repo');
    await expect(resolveInside(repo, 'nope')).rejects.toThrow(/does not exist/);
    symlinkSync(root, path.join(repo, 'escape'));
    await expect(resolveInside(repo, 'escape')).rejects.toThrow(/outside/);
  });
});

import { lstat, readdir, realpath, rm } from 'node:fs/promises';
import path from 'node:path';

/** Total size of regular files under dir (symlinks are not followed). */
export async function dirSizeBytes(
  dir: string,
  stopAfter = Infinity,
): Promise<number> {
  let total = 0;
  const stack = [dir];
  while (stack.length) {
    const current = stack.pop()!;
    for (const entry of await readdir(current, { withFileTypes: true })) {
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) stack.push(full);
      else if (entry.isFile()) total += (await lstat(full)).size;
      if (total > stopAfter) return total;
    }
  }
  return total;
}

/** Resolves `relative` inside `root`; throws if it escapes (incl. via symlinks). */
export async function resolveInside(
  root: string,
  relative: string,
): Promise<string> {
  const realRoot = await realpath(root);
  const target = await realpath(path.resolve(realRoot, relative)).catch(() => {
    throw new Error(`Folder "${relative}" does not exist in the repository.`);
  });
  if (target !== realRoot && !target.startsWith(realRoot + path.sep)) {
    throw new Error(`Folder "${relative}" points outside the repository.`);
  }
  return target;
}

export async function removeDir(dir: string): Promise<void> {
  await rm(dir, { recursive: true, force: true, maxRetries: 3 });
}

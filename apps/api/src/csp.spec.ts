import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { inlineScriptHashes } from './csp.js';

const sha = (s: string) =>
  `'sha256-${createHash('sha256').update(s).digest('base64')}'`;

describe('inlineScriptHashes', () => {
  it('hashes inline scripts in all HTML files, ignoring external and empty ones', () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'csp-'));
    mkdirSync(path.join(dir, 'sub'));
    writeFileSync(
      path.join(dir, 'index.html'),
      '<script>a()</script><script src="/x.js"></script><script async="">b()</script><script></script>',
    );
    writeFileSync(
      path.join(dir, 'sub', 'p.html'),
      '<script>a()</script><SCRIPT>c()</SCRIPT>',
    );
    writeFileSync(path.join(dir, 'x.js'), '<script>ignored()</script>');
    expect(inlineScriptHashes(dir)).toEqual(
      [sha('a()'), sha('b()'), sha('c()')].sort(),
    );
    rmSync(dir, { recursive: true, force: true });
  });

  it('returns nothing when the UI is not built', () => {
    expect(inlineScriptHashes('/nonexistent')).toEqual([]);
  });
});

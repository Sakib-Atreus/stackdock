import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';

const INLINE_SCRIPT = /<script(?![^>]*\bsrc\s*=)[^>]*>([\s\S]*?)<\/script>/gi;

/**
 * CSP hashes ('sha256-…') of every inline <script> in the static UI export,
 * so script-src doesn't need 'unsafe-inline' (D-17). Computed once at boot.
 */
export function inlineScriptHashes(webDir: string): string[] {
  if (!existsSync(webDir)) return [];
  const hashes = new Set<string>();
  const stack = [webDir];
  while (stack.length) {
    const dir = stack.pop()!;
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) stack.push(full);
      else if (entry.name.endsWith('.html')) {
        const html = readFileSync(full, 'utf8');
        for (const match of html.matchAll(INLINE_SCRIPT)) {
          const body = match[1] ?? '';
          if (body.length === 0) continue;
          hashes.add(
            `'sha256-${createHash('sha256').update(body, 'utf8').digest('base64')}'`,
          );
        }
      }
    }
  }
  return [...hashes].sort();
}

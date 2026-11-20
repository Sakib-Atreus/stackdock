import { test as base } from '@playwright/test';

export { expect } from '@playwright/test';

let counter = 0;

/**
 * - Each test appears to come from its own client IP (the server trusts one
 *   proxy hop in e2e, like on Northflank), so the real login rate limit
 *   (5/min per IP) doesn't make unrelated tests interfere.
 * - Any Content-Security-Policy violation fails the test: the UI must work
 *   under the strict, hash-based CSP.
 */
export const test = base.extend<{ clientIp: string; cspGuard: void }>({
  clientIp: [
    async ({ page }, use) => {
      counter += 1;
      const ip = `198.51.100.${(process.pid + counter) % 250}`;
      await page.setExtraHTTPHeaders({ 'X-Forwarded-For': ip });
      await use(ip);
    },
    { auto: true },
  ],
  cspGuard: [
    async ({ page }, use) => {
      const violations: string[] = [];
      page.on('console', (msg) => {
        if (
          /Content Security Policy|Refused to (execute|load|apply)/i.test(
            msg.text(),
          )
        ) {
          violations.push(msg.text());
        }
      });
      await use();
      if (violations.length) {
        throw new Error(`CSP violations:\n${violations.join('\n')}`);
      }
    },
    { auto: true },
  ],
});

import { test as base } from '@playwright/test';

export { expect } from '@playwright/test';

let counter = 0;

/**
 * Each test appears to come from its own client IP (the server trusts one
 * proxy hop in e2e, like on Northflank), so the real login rate limit
 * (5/min per IP) doesn't make unrelated tests interfere.
 */
export const test = base.extend<{ clientIp: string }>({
  clientIp: [
    async ({ page }, use) => {
      counter += 1;
      const ip = `198.51.100.${(process.pid + counter) % 250}`;
      await page.setExtraHTTPHeaders({ 'X-Forwarded-For': ip });
      await use(ip);
    },
    { auto: true },
  ],
});

import type { Page } from '@playwright/test';
import { expect, test } from './fixtures';
import { ADMIN } from './global-setup';

async function signIn(page: Page, next: string) {
  await page.goto(`/login?next=${encodeURIComponent(next)}`);
  await page.getByLabel('Email').fill(ADMIN.email);
  await page.getByLabel('Password').fill(ADMIN.password);
  await page.getByRole('button', { name: 'Sign in' }).click();
}

test('deploy, view logs, add a database, redeploy, stop', async ({
  page,
  context,
}) => {
  test.setTimeout(120_000);
  await signIn(page, '/projects/view?slug=webapp');
  await expect(page.getByRole('heading', { name: 'Web App' })).toBeVisible();
  await expect(page.getByText('No deployments yet')).toBeVisible();

  // Deploy and follow it to Live.
  await page.getByRole('button', { name: 'Deploy', exact: true }).click();
  await expect(page.getByText('Deployment queued')).toBeVisible();
  const buildLog = page.getByLabel('Build log');
  await expect(buildLog).toContainText('$ npm install', { timeout: 30_000 });
  await expect(page.getByText('Running', { exact: true })).toBeVisible({
    timeout: 60_000,
  });
  await expect(buildLog).toContainText('Live.');
  await expect(page.getByRole('button', { name: 'Redeploy' })).toBeVisible();

  // The app itself is reachable.
  const appPage = await context.newPage();
  await appPage.goto('/apps/webapp/');
  await expect(appPage.locator('body')).toContainText('"version":"e2e-v1"');
  await expect(appPage.locator('body')).toContainText('"hasDatabaseUrl":false');
  await appPage.close();

  // Runtime logs stream in.
  await expect(page.getByLabel('Runtime logs')).toContainText(
    'Healthy. Now serving',
    {
      timeout: 10_000,
    },
  );

  // Database: create, then redeploy so the app gets DATABASE_URL.
  await page.getByRole('button', { name: 'Create database' }).click();
  await page
    .getByRole('alertdialog')
    .getByRole('button', { name: 'Create' })
    .click();
  await expect(page.getByText('proj_webapp', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Redeploy' }).click();
  await expect(page.getByText('Deployment queued')).toBeVisible();
  await expect(page.getByText('Replaced')).toBeVisible({ timeout: 60_000 });

  const appPage2 = await context.newPage();
  await appPage2.goto('/apps/webapp/');
  await expect(appPage2.locator('body')).toContainText('"hasDatabaseUrl":true');
  await appPage2.close();

  // Stop needs confirmation; then the app shows the not-running page.
  await page.getByRole('button', { name: 'Stop' }).click();
  await page
    .getByRole('alertdialog')
    .getByRole('button', { name: 'Stop' })
    .click();
  await expect(page.getByText('Stopped.', { exact: true })).toBeVisible();
  const res = await page.request.get('/apps/webapp/');
  expect(res.status()).toBe(503);

  // Start the last build again without rebuilding.
  await page.getByRole('button', { name: 'Start last build' }).click();
  await expect(page.getByText('Restarted.')).toBeVisible({ timeout: 30_000 });
  expect((await page.request.get('/apps/webapp/')).status()).toBe(200);

  // Delete the database (typed confirmation).
  await page.getByRole('button', { name: 'Delete database' }).click();
  const confirm = page
    .getByRole('alertdialog')
    .getByRole('button', { name: 'Delete database' });
  await expect(confirm).toBeDisabled();
  await page.getByLabel(/to confirm/).fill('webapp');
  await confirm.click();
  await expect(page.getByText('Database deleted.')).toBeVisible();

  // Leave nothing running.
  await page.getByRole('button', { name: 'Stop' }).click();
  await page
    .getByRole('alertdialog')
    .getByRole('button', { name: 'Stop' })
    .click();
  await expect(page.getByText('Stopped.', { exact: true })).toBeVisible();
});

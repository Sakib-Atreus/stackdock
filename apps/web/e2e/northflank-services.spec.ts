import type { Page } from '@playwright/test';
import { expect, test } from './fixtures';
import { ADMIN } from './global-setup';

const TOKEN = 'nf-e2e-valid-team-token-0123456789';

async function signInAndConnect(page: Page) {
  await page.request.get('http://127.0.0.1:4310/__reset');
  await page.goto('/login?next=/settings');
  await page.getByLabel('Email').fill(ADMIN.email);
  await page.getByLabel('Password').fill(ADMIN.password);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(
    page.getByText('Northflank connection', { exact: true }),
  ).toBeVisible();
  // Wait until the card has loaded (either state) before deciding.
  const tokenInput = page.getByLabel('Northflank API token');
  await expect(
    tokenInput.or(page.getByRole('button', { name: 'Test connection' })),
  ).toBeVisible();
  if (await tokenInput.isVisible()) {
    await page.getByLabel('Northflank API token').fill(TOKEN);
    await page.getByRole('button', { name: 'Connect' }).click();
    await expect(page.getByText('Northflank connected.')).toBeVisible();
  }
}

// Leave the account disconnected so other tests start from a clean state.
test.afterEach(async ({ page }) => {
  await page.request.delete('/api/v1/providers/northflank', {
    headers: { 'X-Requested-With': 'stackdock' },
  });
});

test('browse Northflank projects, services and builds; start a build', async ({
  page,
}) => {
  await signInAndConnect(page);
  await page.getByRole('link', { name: 'Northflank' }).click();

  // StackDock's own service
  await expect(page.getByText('On Northflank')).toBeVisible();
  await expect(
    page.getByText('dash--stackdock--e2e-proj--abc1.code.run'),
  ).toBeVisible();

  // Projects & services
  await expect(page.getByLabel('Northflank project')).toHaveValue('e2e-proj');
  await page.getByRole('button', { name: /StackDock combined/ }).click();
  await expect(page.getByText('me/stackdock · branch main')).toBeVisible();
  await expect(page.getByText('aaaaaaa')).toBeVisible();

  await page.getByRole('button', { name: 'Start build' }).click();
  const dialog = page.getByRole('alertdialog');
  await expect(dialog.getByLabel('Branch')).toHaveValue('main');
  await dialog.getByLabel('Branch').fill('release');
  await dialog.getByRole('button', { name: 'Start build' }).click();
  await expect(page.getByText('Build started on Northflank.')).toBeVisible();
  await expect(page.getByText('bbbbbbb')).toBeVisible();

  // An image-based service has no builds
  await page.getByRole('button', { name: /Image API deployment/ }).click();
  await expect(
    page.getByText('This service runs an image; it has no builds.'),
  ).toBeVisible();

  await page.getByRole('link', { name: 'Activity' }).click();
  await expect(
    page.getByText('Northflank build started').first(),
  ).toBeVisible();
});

test('give a project its own URL and remove it again', async ({ page }) => {
  await signInAndConnect(page);
  await page.goto('/projects/view?slug=webapp');
  await expect(page.getByRole('heading', { name: 'Web App' })).toBeVisible();

  await page.getByRole('button', { name: 'Get own URL' }).click();
  const dialog = page.getByRole('alertdialog');
  await expect(dialog).toContainText('restarts StackDock');
  await dialog.getByRole('button', { name: 'Add port and restart' }).click();
  await expect(
    page.getByText(/Northflank is applying the change/),
  ).toBeVisible();
  await expect(
    page.getByText('Port added; the URL appears after StackDock restarts.'),
  ).toBeVisible();

  // The port shows up on StackDock's service
  await page.getByRole('link', { name: 'Northflank' }).click();
  await expect(
    page.getByText('URL appears after StackDock restarts'),
  ).toBeVisible();

  await page.goto('/projects/view?slug=webapp');
  await page.getByRole('button', { name: 'Remove' }).click();
  await page
    .getByRole('alertdialog')
    .getByRole('button', { name: 'Remove port and restart' })
    .click();
  await expect(page.getByRole('button', { name: 'Get own URL' })).toBeVisible();
});

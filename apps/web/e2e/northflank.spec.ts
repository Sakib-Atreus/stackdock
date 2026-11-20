import { expect, test } from './fixtures';
import { ADMIN } from './global-setup';

const VALID_TOKEN = 'nf-e2e-valid-team-token-0123456789';

test('connect, test, replace-cancel and disconnect Northflank; token never exposed', async ({
  page,
}) => {
  const responses: string[] = [];
  page.on('response', async (res) => {
    if (res.url().includes('/api/v1/')) {
      responses.push(await res.text().catch(() => ''));
    }
  });

  await page.goto('/login?next=/settings');
  await page.getByLabel('Email').fill(ADMIN.email);
  await page.getByLabel('Password').fill(ADMIN.password);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(
    page.getByText('Northflank connection', { exact: true }),
  ).toBeVisible();

  // Wrong token → clear error, nothing connected
  await page
    .getByLabel('Northflank API token')
    .fill('nf-wrong-token-000000000000');
  await page.getByRole('button', { name: 'Connect' }).click();
  await expect(
    page.getByText('Northflank rejected the API token'),
  ).toBeVisible();

  // Valid token
  await page.getByLabel('Northflank API token').fill(VALID_TOKEN);
  await page.getByRole('button', { name: 'Connect' }).click();
  await expect(page.getByText('Northflank connected.')).toBeVisible();
  await expect(page.getByText('StackDock E2E')).toBeVisible();
  await expect(page.getByText('e2e-team')).toBeVisible();
  await expect(page.getByText(`••••${VALID_TOKEN.slice(-4)}`)).toBeVisible();

  await page.getByRole('button', { name: 'Test connection' }).click();
  await expect(page.getByText('Connection works.')).toBeVisible();

  // Overview shows it too
  await page.getByRole('link', { name: 'Overview' }).click();
  await expect(page.getByText(/Team e2e-team/)).toBeVisible();

  // Disconnect requires confirmation
  await page.getByRole('link', { name: 'Settings' }).click();
  await page
    .getByRole('main')
    .getByRole('button', { name: 'Disconnect' })
    .click();
  await expect(page.getByRole('alertdialog')).toBeVisible();
  await page.getByRole('button', { name: 'Cancel' }).click();
  await expect(page.getByRole('alertdialog')).toBeHidden();
  await expect(
    page.getByRole('button', { name: 'Test connection' }),
  ).toBeVisible();

  await page
    .getByRole('main')
    .getByRole('button', { name: 'Disconnect' })
    .click();
  await page
    .getByRole('alertdialog')
    .getByRole('button', { name: 'Disconnect' })
    .click();
  await expect(
    page.getByText('Disconnected. The token was deleted.'),
  ).toBeVisible();
  await expect(page.getByLabel('Northflank API token')).toBeVisible();

  // Activity log records it all
  await page.getByRole('link', { name: 'Activity' }).click();
  // (Other tests also write to the shared log, so check the newest entries.)
  const rows = page.getByRole('listitem');
  await expect(rows.nth(0)).toContainText('Northflank disconnected');
  await expect(
    rows
      .filter({ hasText: 'Northflank connected' })
      .filter({ hasText: 'Failed' })
      .first(),
  ).toBeVisible();

  // The token never came back from the API.
  expect(responses.join('\n')).not.toContain(VALID_TOKEN);
});

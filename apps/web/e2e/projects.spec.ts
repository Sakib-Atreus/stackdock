import type { Page } from '@playwright/test';
import { expect, test } from './fixtures';
import { ADMIN } from './global-setup';

const SECRET = 'e2e-super-secret-value-42';

async function signIn(page: Page, next: string) {
  await page.goto(`/login?next=${encodeURIComponent(next)}`);
  await page.getByLabel('Email').fill(ADMIN.email);
  await page.getByLabel('Password').fill(ADMIN.password);
  await page.getByRole('button', { name: 'Sign in' }).click();
}

test('project lifecycle: create, env vars, edit, archive, restore, delete', async ({
  page,
}) => {
  const apiBodies: string[] = [];
  page.on('response', async (res) => {
    if (res.url().includes('/api/v1/'))
      apiBodies.push(await res.text().catch(() => ''));
  });

  await signIn(page, '/projects');
  await expect(
    page.getByRole('heading', { name: 'Projects', exact: true }),
  ).toBeVisible();
  await page.getByRole('link', { name: 'New project' }).first().click();

  // Client-side validation
  await page.getByLabel('Short name').fill('Bad Name');
  await page.getByLabel('Display name').fill('Blog');
  await page
    .getByLabel('Public GitHub repository')
    .fill('https://gitlab.com/me/blog');
  await page.getByRole('button', { name: 'Create project' }).click();
  await expect(page.getByText(/lowercase letters/)).toBeVisible();
  await expect(page.getByText(/public GitHub URL/)).toBeVisible();

  // Valid
  await page.getByLabel('Short name').fill('blog');
  await page
    .getByLabel('Public GitHub repository')
    .fill('https://github.com/me/blog.git');
  await page.getByLabel('Language').selectOption('PYTHON');
  await expect(page.getByLabel('Start command (optional)')).toHaveAttribute(
    'placeholder',
    /gunicorn/,
  );
  await page.getByLabel('Health check path (optional)').fill('/health');
  await page.getByRole('button', { name: 'Create project' }).click();

  await expect(page).toHaveURL(/\/projects\/view\?slug=blog/);
  await expect(
    page.getByRole('heading', { name: 'Blog', exact: true }),
  ).toBeVisible();
  await expect(page.getByText('me/blog')).toBeVisible();
  await expect(page.getByText('/apps/blog/')).toBeVisible();
  await expect(page.getByText('Not deployed')).toBeVisible();

  // Env var: add
  await page.getByRole('button', { name: 'Add variable' }).click();
  await page.getByLabel('Name', { exact: true }).fill('API_KEY');
  await page.getByLabel('Value', { exact: true }).fill(SECRET);
  await page.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByText('API_KEY added.')).toBeVisible();
  await expect(page.locator('li', { hasText: 'API_KEY' })).toBeVisible();
  await expect(page.getByText(SECRET)).toHaveCount(0);

  // Reserved name rejected in the browser
  await page.getByRole('button', { name: 'Add variable' }).click();
  await page.getByLabel('Name', { exact: true }).fill('PORT');
  await page.getByLabel('Value', { exact: true }).fill('1');
  await page.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByText('This name is set by StackDock')).toBeVisible();
  await page.getByRole('button', { name: 'Cancel' }).click();

  // Replace needs confirmation
  await page.getByRole('button', { name: 'Replace' }).click();
  await page.getByLabel('New value', { exact: true }).fill('another-secret');
  await page.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByRole('alertdialog')).toContainText('Replace API_KEY?');
  await page
    .getByRole('alertdialog')
    .getByRole('button', { name: 'Replace' })
    .click();
  await expect(page.getByText('API_KEY replaced.')).toBeVisible();

  // Delete var
  await page.getByRole('button', { name: 'Delete API_KEY' }).click();
  await page
    .getByRole('alertdialog')
    .getByRole('button', { name: 'Delete' })
    .click();
  await expect(page.getByText('API_KEY deleted.')).toBeVisible();
  await expect(page.getByText('No variables yet.')).toBeVisible();

  // Edit
  await page.getByRole('link', { name: 'Edit' }).click();
  await expect(page.getByLabel('Short name')).toBeDisabled();
  await page.getByLabel('Display name').fill('Blog v2');
  await page.getByRole('button', { name: 'Save changes' }).click();
  await expect(page.getByRole('heading', { name: 'Blog v2' })).toBeVisible();
  await expect(page.getByText('Python')).toBeVisible();

  // Archive → hidden from list → restore
  await page.getByRole('button', { name: 'Archive' }).click();
  await page
    .getByRole('alertdialog')
    .getByRole('button', { name: 'Archive' })
    .click();
  await expect(page.getByText(/Archived on/)).toBeVisible();
  await page.getByRole('link', { name: 'Projects' }).first().click();
  await expect(page.getByRole('link', { name: /Blog v2/ })).toHaveCount(0);
  await page.getByRole('tab', { name: 'archived' }).click();
  await page.getByRole('link', { name: /Blog v2/ }).click();
  await page.getByRole('button', { name: 'Restore' }).click();
  await expect(page.getByText(/Archived on/)).toHaveCount(0);

  // Permanent delete: must archive first and type the name
  await page.getByRole('button', { name: 'Archive' }).click();
  await page
    .getByRole('alertdialog')
    .getByRole('button', { name: 'Archive' })
    .click();
  await page.getByRole('button', { name: 'Delete permanently' }).click();
  const confirm = page.getByRole('alertdialog').getByRole('button', {
    name: 'Delete permanently',
  });
  await expect(confirm).toBeDisabled();
  await page.getByLabel(/to confirm/).fill('blog');
  await confirm.click();
  await expect(page).toHaveURL(/\/projects$/);
  await expect(page.getByRole('link', { name: /Blog/ })).toHaveCount(0);

  // Audit trail
  await page.getByRole('link', { name: 'Activity' }).click();
  await expect(page.getByText('Project deleted').first()).toBeVisible();

  expect(apiBodies.join('\n')).not.toContain(SECRET);
});

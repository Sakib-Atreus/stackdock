import type { Page } from '@playwright/test';
import { expect, test } from './fixtures';
import { ADMIN } from './global-setup';

async function signIn(page: Page, password = ADMIN.password) {
  await page.getByLabel('Email').fill(ADMIN.email);
  await page.getByLabel('Password').fill(password);
  await page.getByRole('button', { name: 'Sign in' }).click();
}

test('redirects to login, signs in, returns to the requested page, signs out', async ({
  page,
}) => {
  await page.goto('/projects');
  await expect(page).toHaveURL(/\/login\?next=%2Fprojects/);
  await expect(page.getByRole('heading', { name: 'Sign in' })).toBeVisible();

  await signIn(page);
  await expect(page).toHaveURL(/\/projects$/);
  await expect(
    page.getByRole('heading', { name: 'Projects', exact: true }),
  ).toBeVisible();
  await expect(page.getByText(ADMIN.email)).toBeVisible();

  // Session cookie is HTTP-only (not readable by page scripts).
  expect(await page.evaluate(() => document.cookie)).not.toContain(
    'sd_session',
  );

  await page.getByRole('button', { name: 'Sign out' }).click();
  await expect(page).toHaveURL(/\/login/);
  await page.goto('/');
  await expect(page).toHaveURL(/\/login/);
});

test('shows a generic error for wrong credentials', async ({ page }) => {
  await page.goto('/login');
  await signIn(page, 'definitely wrong');
  await expect(
    page.getByRole('alert').filter({ hasText: 'Invalid' }),
  ).toHaveText('Invalid email or password.');
  await expect(page).toHaveURL(/\/login/);
});

test('ignores external redirect targets after login', async ({ page }) => {
  await page.goto('/login?next=//evil.example');
  await signIn(page);
  await expect(page).toHaveURL(/localhost:4300\/$/);
  await expect(page.getByRole('heading', { name: 'Overview' })).toBeVisible();
});

test('settings shows the active session', async ({ page }) => {
  await page.goto('/login?next=/settings');
  await signIn(page);
  await expect(page.getByRole('heading', { name: 'Settings' })).toBeVisible();
  await expect(page.getByText('This browser')).toBeVisible();
});

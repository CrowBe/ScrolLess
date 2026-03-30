import { test, expect } from '@playwright/test';

test('app loads and shows source filter', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('.source-filter')).toBeVisible({ timeout: 10000 });
});

test('can navigate to settings via bottom nav', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Settings' }).first().click();
  await expect(page.locator('.source-filter')).not.toBeVisible();
});

test('can switch to Discover view', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Discover' }).first().click();
  await expect(page.locator('.chip--active', { hasText: 'Discover' })).toBeVisible();
});

test('feed view visual snapshot', async ({ page }) => {
  await page.goto('/');
  await page.waitForLoadState('networkidle');
  await expect(page).toHaveScreenshot('feed-empty.png', { fullPage: true });
});

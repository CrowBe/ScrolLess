/**
 * Screenshot capture script for testing session round 2.
 */
import { test, expect } from '@playwright/test';
import path from 'path';

const SS = path.resolve('./screenshots');
const BASE = 'http://localhost:3333';

test.use({ viewport: { width: 390, height: 844 } });

test('01 – feed: notification prompt + all items', async ({ page }) => {
  // Clear dismissed flag so prompt always shows
  await page.addInitScript(() => localStorage.removeItem('notification-dismissed'));
  await page.goto(BASE);
  await page.waitForTimeout(800);
  await page.screenshot({ path: `${SS}/01-feed-all.png` });
});

test('02 – feed: YouTube filter', async ({ page }) => {
  await page.goto(BASE);
  await page.getByRole('button', { name: /YouTube/i }).click();
  await page.waitForTimeout(300);
  await page.screenshot({ path: `${SS}/02-feed-youtube.png` });
});

test('03 – feed: X filter', async ({ page }) => {
  await page.goto(BASE);
  // X button text is "X1" (no space), so match loosely
  await page.locator('button', { hasText: /^X\d*$/ }).click();
  await page.waitForTimeout(300);
  await page.screenshot({ path: `${SS}/03-feed-x.png` });
});

test('04 – feed: News filter', async ({ page }) => {
  await page.goto(BASE);
  await page.getByRole('button', { name: /News/i }).click();
  await page.waitForTimeout(300);
  await page.screenshot({ path: `${SS}/04-feed-news.png` });
});

test('05 – feed: Discover sub-tab', async ({ page }) => {
  await page.goto(BASE);
  // Click the Discover sub-tab (inside the feed, not bottom nav)
  const discoverSubTab = page.locator('.source-filter button, [role="tab"]', { hasText: /^Discover$/ }).first();
  if (await discoverSubTab.isVisible()) {
    await discoverSubTab.click();
  } else {
    // fallback: click any button labelled Discover that is NOT in nav
    await page.locator('button:not(nav button)', { hasText: /Discover/ }).first().click();
  }
  await page.waitForTimeout(300);
  await page.screenshot({ path: `${SS}/05-discover-subtab.png` });
});

test('06 – feed: mark all read', async ({ page }) => {
  await page.addInitScript(() => localStorage.removeItem('notification-dismissed'));
  await page.goto(BASE);
  // Dismiss notification prompt if present
  const notNow = page.getByRole('button', { name: /Not now/i });
  if (await notNow.isVisible({ timeout: 1000 }).catch(() => false)) {
    await notNow.click();
    await page.waitForTimeout(200);
  }
  await page.getByRole('button', { name: /Mark all read/i }).click();
  await page.waitForTimeout(500);
  await page.screenshot({ path: `${SS}/06-mark-all-read.png` });
});

test('07 – feed: card expand (click card)', async ({ page }) => {
  await page.goto(BASE);
  // Cards use class card__body — click inside the first one
  const firstCardTitle = page.locator('.card__title').first();
  if (await firstCardTitle.isVisible({ timeout: 3000 }).catch(() => false)) {
    await firstCardTitle.click();
    await page.waitForTimeout(500);
  }
  await page.screenshot({ path: `${SS}/07-card-expanded.png` });
});

test('08 – Saved tab (via bottom nav click)', async ({ page }) => {
  await page.goto(BASE);
  await page.waitForTimeout(400);
  await page.locator('nav').getByText('Saved').click();
  await page.waitForTimeout(400);
  await page.screenshot({ path: `${SS}/08-saved.png` });
});

test('09 – Discover nav tab (via bottom nav click)', async ({ page }) => {
  await page.goto(BASE);
  await page.waitForTimeout(400);
  await page.locator('nav').getByText('Discover').click();
  await page.waitForTimeout(400);
  await page.screenshot({ path: `${SS}/09-discover-nav.png` });
});

test('10 – Settings: source list (via nav click)', async ({ page }) => {
  await page.goto(BASE);
  await page.waitForTimeout(400);
  await page.locator('nav button', { hasText: /Settings/ }).click();
  await page.waitForTimeout(600);
  await page.screenshot({ path: `${SS}/10-settings.png` });
});

test('11 – Settings: add source form open', async ({ page }) => {
  await page.goto(BASE);
  await page.waitForTimeout(400);
  await page.locator('nav button', { hasText: /Settings/ }).click();
  await page.waitForTimeout(400);
  const addBtn = page.locator('button', { hasText: /add source/i });
  if (await addBtn.isVisible({ timeout: 2000 }).catch(() => false)) {
    await addBtn.click();
    await page.waitForTimeout(400);
  }
  await page.screenshot({ path: `${SS}/11-add-source-form.png` });
});

test('12 – Settings: source toggle', async ({ page }) => {
  await page.goto(BASE);
  await page.waitForTimeout(400);
  await page.locator('nav button', { hasText: /Settings/ }).click();
  await page.waitForTimeout(400);
  const toggle = page.locator('input[type="checkbox"]').first();
  if (await toggle.isVisible({ timeout: 2000 }).catch(() => false)) {
    await toggle.click();
    await page.waitForTimeout(400);
  }
  await page.screenshot({ path: `${SS}/12-source-toggled.png` });
});

/**
 * UR6/R36 — responsive viewport screenshot matrix.
 *
 * Captures layout chrome, a table/list page, and a detail page at the
 * breakpoints we design for: 375 (mobile), 768 (tablet), 1280 (laptop),
 * 1920 (ultra-wide + 2xl sidebar).
 *
 * Regenerate baselines after intentional UI changes:
 *   npm run test:parity:responsive:update
 */
import { test, expect } from '@playwright/test';
import { installApiMocks } from './_fixtures.js';

const VIEWPORTS = [
  { label: '375', width: 375, height: 812 },
  { label: '768', width: 768, height: 1024 },
  { label: '1280', width: 1280, height: 800 },
  { label: '1920', width: 1920, height: 1080 },
] as const;

for (const vp of VIEWPORTS) {
  test.describe(`viewport ${vp.label}px`, () => {
    test.beforeEach(async ({ page }) => {
      await page.setViewportSize({ width: vp.width, height: vp.height });
      await page.emulateMedia({ reducedMotion: 'reduce' });
      await installApiMocks(page);
    });

    test('layout shell — header chrome', async ({ page }) => {
      await page.goto('/documents?view=parsed');
      await expect(page.getByRole('heading', { name: /Documents/i })).toBeVisible({ timeout: 15_000 });
      await page.waitForLoadState('networkidle');
      await expect(page.locator('header')).toHaveScreenshot(`layout-header-${vp.label}.png`);
    });

    test('table page — parsed documents list', async ({ page }) => {
      await page.goto('/documents?view=parsed');
      if (vp.width >= 1024) {
        await expect(page.getByRole('columnheader', { name: /PO/i })).toBeVisible({ timeout: 15_000 });
      } else {
        await expect(page.getByTestId('transaction-mobile-cards')).toBeVisible({ timeout: 15_000 });
      }
      await page.waitForLoadState('networkidle');
      await expect(page).toHaveScreenshot(`documents-table-${vp.label}.png`, { fullPage: false });
    });

    test('detail page — lifecycle timeline', async ({ page }) => {
      await page.goto('/lifecycle/PO-12345');
      await expect(page.getByText('850', { exact: false }).first()).toBeVisible({ timeout: 15_000 });
      await page.waitForLoadState('networkidle');
      await expect(page).toHaveScreenshot(`lifecycle-detail-${vp.label}.png`, { fullPage: false });
    });
  });
}

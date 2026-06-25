/**
 * D5 Sprint 1 — lifecycle view parity.
 *
 * Navigates to a known PO route, awaits the lifecycle timeline to
 * render, then screenshots. Exercises the North Star feature
 * (transaction lifecycle stitching) so any visual regression in the
 * timeline rendering fails the test.
 */
import { test, expect } from '@playwright/test';
import { installApiMocks } from './_fixtures.js';

test.beforeEach(async ({ page }) => {
  await installApiMocks(page);
});

test('lifecycle page renders the timeline for a PO', async ({ page }) => {
  // The route is `/lifecycle/:po` (see apps/web/src/App.tsx). The
  // fixture canned the lifecycle response for any GET to /api/lifecycle,
  // so the PO segment here doesn't have to match a real row.
  await page.goto('/lifecycle/PO-12345');

  // The fixture has four events — the 850 is the first. Wait for it to
  // appear so we know the timeline rendered.
  await expect(page.getByText('850', { exact: false }).first()).toBeVisible({ timeout: 15_000 });
  await page.waitForLoadState('networkidle');

  await expect(page).toHaveScreenshot('lifecycle-view.png', {
    fullPage: false,
  });
});

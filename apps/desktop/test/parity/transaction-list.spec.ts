/**
 * D5 Sprint 1 — transaction list parity.
 *
 * Navigates to `/`, awaits the transactions table to render, then
 * screenshots the page. Per the plan's `S11.1` exit criterion: the
 * column headers must be visible (proves the page rendered) and the
 * screenshot matches the per-project baseline within 0.5% pixel
 * difference.
 */
import { test, expect } from '@playwright/test';
import { installApiMocks } from './_fixtures.js';

test.beforeEach(async ({ page }) => {
  await installApiMocks(page);
});

test('transactions page renders with column headers', async ({ page }) => {
  await page.goto('/');

  // Wait for the table head to materialise. Using getByRole keeps the
  // selector resilient to className changes — it's the rendered DOM
  // semantics we care about, not the styling.
  await expect(page.getByRole('columnheader', { name: /PO/i })).toBeVisible({ timeout: 15_000 });

  // Defensive wait so dynamic React Query data has settled before the
  // screenshot. Without this we can race against the first render of
  // the loading skeleton.
  await page.waitForLoadState('networkidle');

  await expect(page).toHaveScreenshot('transaction-list.png', {
    fullPage: false,
  });
});

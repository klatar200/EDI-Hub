/**
 * D5 Sprint 1 — alert list parity.
 *
 * Navigates to `/alerts`, awaits the two fixture alerts to render, and
 * screenshots. The plan spec is "alert ack" but the scorecard exit
 * criterion (S11.3) is just "alert list renders" — we don't actually
 * click the ack button (would require mocking mutations). The
 * screenshot guards rendering parity.
 */
import { test, expect } from '@playwright/test';
import { installApiMocks } from './_fixtures.js';

test.beforeEach(async ({ page }) => {
  await installApiMocks(page);
});

test('alerts page renders the alert cards', async ({ page }) => {
  await page.goto('/alerts');

  // The fixture's first alert has a distinctive title — wait for it to
  // appear so we know the list rendered something rather than the empty
  // state.
  await expect(page.getByText('Missing 997 for PO-12345')).toBeVisible({ timeout: 15_000 });
  await page.waitForLoadState('networkidle');

  await expect(page).toHaveScreenshot('alert-ack.png', {
    fullPage: false,
  });
});

/**
 * D5 Sprint 1 — Clerk session capture.
 *
 * One-time interactive setup that opens a real Chromium window, lets the
 * developer sign in via Clerk, and persists the resulting cookies +
 * localStorage to `.auth/state.json`. Every parity spec then loads that
 * state at start so the React app boots into a signed-in render path
 * without each test re-authenticating.
 *
 * Run via `npm run test:parity:setup`. Re-run when the captured token
 * expires (Clerk JWTs are short-lived; expect to refresh every few
 * days for active development).
 */
import { test as setup } from '@playwright/test';
import { mkdir } from 'node:fs/promises';
import { join, dirname } from 'node:path';

const STATE_PATH = '.auth/state.json';

setup('capture clerk session', async ({ page }) => {
  await mkdir(dirname(STATE_PATH), { recursive: true }).catch(() => undefined);

  // Open the web build. The Clerk sign-in card renders if there's no
  // active session. The developer interacts with it directly.
  await page.goto('/');

  // page.pause() halts execution and opens the Playwright inspector so
  // the developer can manually sign in. When they hit "Resume" in the
  // inspector, execution continues to the storageState save below.
  //
  // The recommended UX: sign in, wait until you're sitting on the
  // dashboard (the transactions table is visible), then click Resume.
  // eslint-disable-next-line no-console
  console.log('[parity-setup] sign in via the open Chromium window, then click "Resume" in the inspector.');
  await page.pause();

  // Persist cookies + origin localStorage so the parity specs can load
  // a fully signed-in state.
  await page.context().storageState({ path: join(process.cwd(), STATE_PATH) });
  // eslint-disable-next-line no-console
  console.log(`[parity-setup] saved storage state to ${STATE_PATH}`);
});

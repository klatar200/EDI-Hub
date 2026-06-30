/**
 * D5 Sprint 1 — Playwright parity test harness.
 * UR6/R36 — responsive-viewports.spec.ts adds 375/768/1280/1920 snapshots.
 *
 * Locks UI consistency between the web build (Vite dev) and the LAN-server
 * desktop build (Fastify-served apps/web/dist on :3000). The two should
 * render byte-identical screenshots for the same React tree; this config
 * runs each spec under TWO projects and lets `toHaveScreenshot` compare
 * against a per-project baseline.
 *
 * Operating modes:
 *
 *   - `npm run test:parity`              — run both projects (assumes both
 *                                          services are up; desktop needs
 *                                          `npm run -w @edi/desktop dev`
 *                                          running separately).
 *   - `npm run test:parity -- --project=web`     — web project only (CI).
 *   - `npm run test:parity -- --project=desktop` — desktop only (manual).
 *   - `npm run test:parity:update`       — regenerate baselines after an
 *                                          intentional UI change.
 *
 * Vite is started automatically by the `webServer` block so CI doesn't
 * need a separate orchestration step. The desktop stack is NOT started
 * automatically — Postgres + the API child + the splash screen carry too
 * much side effect for an auto-started webServer to manage cleanly.
 */
import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './apps/desktop/test/parity',
  // CI fails fast; locally we surface a single diff per run.
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  // Retries help paper over flaky animation timing, not flaky pixels.
  retries: process.env.CI ? 1 : 0,
  workers: 1,
  reporter: process.env.CI ? [['github'], ['html', { open: 'never' }]] : 'list',

  // 0.5% pixel-diff threshold per S11.* scorecard ("Fail if pixel
  // difference > 0.5% of total pixels"). The maxDiffPixelRatio reading is
  // a fraction (0.005 = 0.5%), not a percentage.
  expect: {
    toHaveScreenshot: {
      maxDiffPixelRatio: 0.005,
      // Anti-alias differences across renderer versions: we don't want a
      // half-pixel font-hinting shift to fail a test. Per Playwright docs,
      // this loosens the per-pixel comparison without raising the overall
      // diff ratio.
      threshold: 0.2,
    },
  },

  use: {
    // Lock viewport so screenshots are deterministic across machines.
    viewport: { width: 1280, height: 800 },
    // Lock device scale to 1 so a Retina test box doesn't produce 2x baselines.
    deviceScaleFactor: 1,
    // Don't capture the page if there's no test failure — keeps the repo small.
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
  },

  projects: [
    // Interactive setup project. Run via `npm run test:parity:setup`. It
    // pauses for the developer to sign in manually, then writes the
    // resulting Clerk session to .auth/state.json. The other projects
    // then load that state at start so each test boots already-signed-in.
    {
      name: 'setup',
      testMatch: /_auth\.setup\.ts/,
      use: {
        ...devices['Desktop Chrome'],
        baseURL: 'http://localhost:5173',
        // Headed so the developer can interact with Clerk's sign-in card.
        headless: false,
      },
    },
    {
      name: 'web',
      testIgnore: /_auth\.setup\.ts/,
      use: {
        ...devices['Desktop Chrome'],
        baseURL: 'http://localhost:5173',
        storageState: '.auth/state.json',
      },
    },
    {
      name: 'desktop',
      testIgnore: /_auth\.setup\.ts/,
      use: {
        ...devices['Desktop Chrome'],
        baseURL: 'http://127.0.0.1:3000',
        storageState: '.auth/state.json',
      },
    },
  ],

  // Auto-start Vite for the web project. The check `cwd` runs the script
  // in apps/web's workspace context so `vite` resolves correctly. CI also
  // honors `reuseExistingServer: false` so a stale dev process can't
  // accidentally satisfy the readiness probe.
  webServer: [
    {
      command: 'npm run dev --workspace=@edi/web',
      url: 'http://localhost:5173',
      reuseExistingServer: !process.env.CI,
      timeout: 60_000,
      stdout: 'ignore',
      stderr: 'pipe',
    },
  ],
});

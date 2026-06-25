/**
 * Desktop track D1 Sprint 4 — `test:sqlite` wrapper.
 *
 * Runs `npm test` with the SQLite provider/URL env vars set, in a way that
 * works identically on PowerShell, cmd, bash, and zsh. We don't have
 * cross-env in devDependencies and adding it just for this is overkill.
 *
 * Note: the .test.ts suite currently uses in-memory Prisma fakes and does
 * NOT actually hit the database. Running it under DATABASE_PROVIDER=sqlite
 * therefore proves only that the test runner boots under the SQLite env —
 * it does NOT prove that real SQLite queries work. The end-to-end SQLite
 * verification lives in `smoke-sqlite.ts`, which round-trips through the
 * real SQLite-generated Prisma client. See `npm run smoke:sqlite`.
 */
import { spawnSync } from 'node:child_process';

const env = {
  ...process.env,
  DATABASE_PROVIDER: 'sqlite',
  DATABASE_URL: 'file:./test.db',
};

const result = spawnSync('npm', ['test'], {
  stdio: 'inherit',
  env,
  shell: true,
});

process.exit(result.status ?? 1);

/**
 * Desktop track D1 Sprint 4 — `smoke:sqlite` wrapper.
 *
 * Bootstraps a fresh SQLite database, then runs the round-trip smoke against
 * the real SQLite-generated Prisma client.
 *
 * Steps:
 *   1. Delete any prior `smoke.sqlite` file so the run starts clean.
 *   2. Apply the SQLite schema via `npm run db:migrate:sqlite` (uses
 *      `prisma db push`, which is what D1 Sprint 2 wired up).
 *   3. Build the API package (TypeScript transpile only — no engine needed).
 *   4. Execute `test/smoke-sqlite.ts` with DATABASE_PROVIDER=sqlite and
 *      DATABASE_URL pointing at the fresh file.
 *
 * Cross-platform: avoids PowerShell-vs-bash syntax differences and the
 * `VAR=value command` idiom by setting env via the spawn `env` option.
 */
import { spawnSync } from 'node:child_process';
import { unlinkSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';

const SMOKE_DB = resolve(process.cwd(), 'smoke.sqlite');

function run(cmd, args, opts = {}) {
  const r = spawnSync(cmd, args, { stdio: 'inherit', shell: true, ...opts });
  if (r.status !== 0) {
    console.error(`\n${cmd} ${args.join(' ')} exited with status ${r.status}`);
    process.exit(r.status ?? 1);
  }
}

// 1. Clean prior run.
if (existsSync(SMOKE_DB)) {
  unlinkSync(SMOKE_DB);
  console.log(`[smoke:sqlite] removed prior ${SMOKE_DB}`);
}

// 2. Migrate the SQLite schema. `db:migrate:sqlite` lives in packages/db; pass
//    DATABASE_URL through so prisma db push writes to our smoke file rather
//    than whatever the developer has in their root .env.
console.log('[smoke:sqlite] applying schema to fresh SQLite file...');
run('npm', ['run', '-w', '@edi/db', 'db:migrate:sqlite'], {
  env: { ...process.env, DATABASE_URL: `file:${SMOKE_DB}` },
});

// 3. Build the API package so tsx can resolve our internal imports.
console.log('[smoke:sqlite] building @edi/api...');
run('npm', ['run', '-w', '@edi/api', 'build']);

// 4. Run the round-trip script.
console.log('[smoke:sqlite] running smoke-sqlite.ts...');
run('npx', ['tsx', 'test/smoke-sqlite.ts'], {
  env: {
    ...process.env,
    DATABASE_PROVIDER: 'sqlite',
    DATABASE_URL: `file:${SMOKE_DB}`,
  },
});

console.log('\n[smoke:sqlite] PASSED');

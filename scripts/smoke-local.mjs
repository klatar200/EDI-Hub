#!/usr/bin/env node
/**
 * Local development smoke — runs the CI gate without cloud credentials.
 *
 *   npm run smoke:local
 *
 * Optional (requires Docker Postgres + MinIO): npm run smoke --workspace=@edi/api
 */
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

function run(cmd: string, args: string[]): void {
  const r = spawnSync(cmd, args, { cwd: root, stdio: 'inherit', shell: process.platform === 'win32' });
  if (r.status !== 0) process.exit(r.status ?? 1);
}

console.log('smoke:local — running npm run test:ci');
run('npm', ['run', 'test:ci']);
console.log('smoke:local — OK');

#!/usr/bin/env node
/**
 * BUILD_PLAN §3.1 — validate local Docker stack (Postgres + MinIO).
 *
 * Prerequisites: Docker Desktop running, `docker compose up -d` (or this script starts it).
 *
 *   npm run validate:local
 */
import { spawnSync } from 'node:child_process';
import { copyFileSync, existsSync } from 'node:fs';
import net from 'node:net';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

function run(cmd, args, opts = {}) {
  const r = spawnSync(cmd, args, {
    cwd: opts.cwd ?? root,
    stdio: 'inherit',
    shell: process.platform === 'win32',
    env: { ...process.env, ...opts.env },
  });
  if (r.status !== 0) {
    throw new Error(`Command failed: ${cmd} ${args.join(' ')}`);
  }
}

function probe(host, port, timeoutMs = 3000) {
  return new Promise((resolve) => {
    const s = net.connect({ host, port });
    const done = (ok) => {
      s.removeAllListeners();
      try { s.destroy(); } catch { /* ignore */ }
      resolve(ok);
    };
    s.setTimeout(timeoutMs, () => done(false));
    s.on('connect', () => done(true));
    s.on('error', () => done(false));
  });
}

async function waitForPorts(ports, label, attempts = 30) {
  for (let i = 0; i < attempts; i += 1) {
    const results = await Promise.all(ports.map((p) => probe('127.0.0.1', p)));
    if (results.every(Boolean)) {
      console.log(`${label} ready on ${ports.join(', ')}`);
      return;
    }
    await new Promise((r) => setTimeout(r, 2000));
  }
  throw new Error(
    `${label} not reachable on localhost (${ports.join(', ')}). ` +
      'Start Docker Desktop and run: docker compose up -d',
  );
}

function hasDocker() {
  const r = spawnSync('docker', ['info'], { stdio: 'ignore', shell: process.platform === 'win32' });
  return r.status === 0;
}

async function main() {
  const envPath = join(root, '.env');
  if (!existsSync(envPath)) {
    console.log('Creating .env from .env.example');
    copyFileSync(join(root, '.env.example'), envPath);
  }

  const pgUp = await probe('127.0.0.1', 5432);
  const minioUp = await probe('127.0.0.1', 9000);

  if (!pgUp || !minioUp) {
    if (hasDocker()) {
      console.log('Starting docker compose services…');
      run('docker', ['compose', 'up', '-d', 'postgres', 'minio']);
      await waitForPorts([5432, 9000], 'Postgres + MinIO');
    } else {
      throw new Error(
        'Postgres (5432) or MinIO (9000) not reachable and Docker CLI unavailable.\n' +
          'Ensure Docker Desktop is running, then: docker compose up -d',
      );
    }
  } else {
    console.log('Postgres + MinIO already reachable');
  }

  console.log('Running database migrations…');
  run('npm', ['run', 'db:migrate']);

  console.log('Running local stack smoke (ingest → parse → lifecycle → detection)…');
  run('npm', ['run', 'smoke:local', '--workspace=@edi/api']);

  console.log('\nvalidate:local — all checks passed');
}

main().catch((err) => {
  console.error('\nvalidate:local FAILED:', err instanceof Error ? err.message : err);
  process.exit(1);
});

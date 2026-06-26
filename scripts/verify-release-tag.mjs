#!/usr/bin/env node
/**
 * CI guard: git tag version must match apps/desktop/package.json version,
 * and (in CI) the tagged commit must be origin/main HEAD.
 *
 * Prevents publishing a release named v0.0.12-alpha that actually
 * contains a 0.0.6-alpha build because the tag was pushed on a stale
 * commit (Jun 2026).
 */
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execSync } from 'node:child_process';

function fail(message) {
  console.error(`verify-release-tag: ${message}`);
  process.exit(1);
}

const tag = process.env.GITHUB_REF_NAME ?? process.argv[2];
if (!tag) {
  fail('no tag provided (GITHUB_REF_NAME or argv[2])');
}

const match = /^v(.+)$/.exec(tag);
if (!match) {
  fail(`tag '${tag}' does not match v* pattern`);
}
const tagVersion = match[1];

const here = dirname(fileURLToPath(import.meta.url));
const pkgPath = resolve(here, '..', 'apps', 'desktop', 'package.json');
const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'));
const pkgVersion = pkg.version;

if (tagVersion !== pkgVersion) {
  fail(
    `tag version '${tagVersion}' does not match ` +
      `apps/desktop/package.json version '${pkgVersion}'. ` +
      'Bump package.json on main BEFORE pushing the tag.',
  );
}

// In CI the workflow checks out the tagged commit. Require that commit to
// be the tip of origin/main so tags cannot be placed on stale history.
const taggedSha = process.env.GITHUB_SHA;
const skipMainCheck = process.env.SKIP_MAIN_HEAD_CHECK === 'true';

if (taggedSha && !skipMainCheck) {
  try {
    execSync('git fetch origin main --quiet', { stdio: ['ignore', 'pipe', 'pipe'] });
  } catch {
    fail('could not fetch origin/main');
  }

  let mainSha;
  try {
    mainSha = execSync('git rev-parse origin/main', { encoding: 'utf8' }).trim();
  } catch {
    fail('could not resolve origin/main');
  }

  if (taggedSha !== mainSha) {
    fail(
      `tag points to commit ${taggedSha.slice(0, 7)} but origin/main is ${mainSha.slice(0, 7)}. ` +
        'Checkout main, pull, bump package.json, push, then tag that commit.',
    );
  }
}

console.log(`verify-release-tag: OK — tag v${tagVersion} matches package.json`);
if (taggedSha && !skipMainCheck) {
  console.log(`verify-release-tag: OK — tag is on origin/main HEAD (${taggedSha.slice(0, 7)})`);
}

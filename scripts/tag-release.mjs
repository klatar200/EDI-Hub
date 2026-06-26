#!/usr/bin/env node
/**
 * Create (and optionally push) a release tag from apps/desktop/package.json.
 *
 * Usage:
 *   node scripts/tag-release.mjs          # create local tag only
 *   node scripts/tag-release.mjs --push     # create and push to origin
 *
 * Run from a clean main branch that is up to date with origin/main.
 */
import { readFileSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

function run(cmd, { allowFail = false } = {}) {
  try {
    return execSync(cmd, { encoding: 'utf8' }).trim();
  } catch (error) {
    if (allowFail) return null;
    throw error;
  }
}

function fail(message) {
  console.error(`tag-release: ${message}`);
  process.exit(1);
}

const push = process.argv.includes('--push');
const here = dirname(fileURLToPath(import.meta.url));
const pkgPath = resolve(here, '..', 'apps', 'desktop', 'package.json');
const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'));
const tag = `v${pkg.version}`;

const branch = run('git rev-parse --abbrev-ref HEAD');
if (branch !== 'main') {
  fail(`must be on main (currently on '${branch}')`);
}

if (run('git status --porcelain')) {
  fail('working tree is not clean — commit or stash changes first');
}

run('git fetch origin main --quiet');

const localMain = run('git rev-parse main');
const remoteMain = run('git rev-parse origin/main');
if (localMain !== remoteMain) {
  fail(
    `local main (${localMain.slice(0, 7)}) is behind/ahead of origin/main (${remoteMain.slice(0, 7)}). ` +
      'Run: git pull origin main',
  );
}

const head = run('git rev-parse HEAD');
if (head !== remoteMain) {
  fail('HEAD is not origin/main — checkout main and pull before tagging');
}

const existing = run(`git tag -l ${tag}`, { allowFail: true });
if (existing) {
  const taggedSha = run(`git rev-list -n 1 ${tag}`);
  if (taggedSha !== head) {
    fail(
      `tag ${tag} already exists on commit ${taggedSha.slice(0, 7)} (HEAD is ${head.slice(0, 7)}). ` +
        `Delete the old tag first: git tag -d ${tag}; git push origin :refs/tags/${tag}`,
    );
  }
  console.log(`tag-release: ${tag} already points to HEAD (${head.slice(0, 7)})`);
} else {
  run(`git tag ${tag}`);
  console.log(`tag-release: created ${tag} at ${head.slice(0, 7)}`);
}

process.env.GITHUB_REF_NAME = tag;
process.env.GITHUB_SHA = head;
process.env.SKIP_MAIN_HEAD_CHECK = 'true';
execSync('node scripts/verify-release-tag.mjs', { stdio: 'inherit', cwd: resolve(here, '..') });

if (push) {
  run(`git push origin ${tag}`);
  console.log(`tag-release: pushed ${tag} — watch Actions → release`);
} else {
  console.log(`tag-release: run 'git push origin ${tag}' to trigger the release workflow`);
}

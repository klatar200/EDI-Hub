#!/usr/bin/env node
/**
 * CI guard: git tag version must match apps/desktop/package.json version.
 *
 * Prevents publishing a release named v0.0.10-alpha that actually
 * contains a 0.0.6-alpha build (the root cause of the broken auto-update
 * feed in Jun 2026).
 */
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const tag = process.env.GITHUB_REF_NAME ?? process.argv[2];
if (!tag) {
  console.error('verify-release-tag: no tag provided (GITHUB_REF_NAME or argv[2])');
  process.exit(1);
}

const match = /^v(.+)$/.exec(tag);
if (!match) {
  console.error(`verify-release-tag: tag '${tag}' does not match v* pattern`);
  process.exit(1);
}
const tagVersion = match[1];

const here = dirname(fileURLToPath(import.meta.url));
const pkgPath = resolve(here, '..', 'apps', 'desktop', 'package.json');
const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'));
const pkgVersion = pkg.version;

if (tagVersion !== pkgVersion) {
  console.error(
    `verify-release-tag: tag version '${tagVersion}' does not match ` +
      `apps/desktop/package.json version '${pkgVersion}'. ` +
      'Bump package.json on main BEFORE pushing the tag.',
  );
  process.exit(1);
}

console.log(`verify-release-tag: OK — tag v${tagVersion} matches package.json`);

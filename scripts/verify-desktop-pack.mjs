#!/usr/bin/env node
/**
 * Fail CI if a Windows unpack is missing runtime deps the main process needs.
 * electron-builder's workspace hoisting walk can skip hoisted packages.
 */
import { existsSync } from 'node:fs';
import { join } from 'node:path';

const appRoot = join('apps', 'desktop', 'dist-installer', 'win-unpacked', 'resources', 'app');
const nodeModules = join(appRoot, 'node_modules');

if (!existsSync(appRoot)) {
  console.error(`verify-desktop-pack: missing unpack dir ${appRoot}`);
  process.exit(1);
}

const requiredPackages = [
  'electron-updater',
  'js-yaml',
  'lazy-val',
  'lodash.isequal',
  'tiny-typed-emitter',
];

const missing = requiredPackages.filter(
  (name) => !existsSync(join(nodeModules, name, 'package.json')),
);

if (missing.length > 0) {
  console.error(`verify-desktop-pack: missing from ${nodeModules}:`);
  for (const name of missing) console.error(`  - ${name}`);
  process.exit(1);
}

const updaterEntry = join(nodeModules, 'electron-updater', 'out', 'main.js');
if (!existsSync(updaterEntry)) {
  console.error(`verify-desktop-pack: electron-updater entry missing at ${updaterEntry}`);
  process.exit(1);
}

console.log('verify-desktop-pack: OK');

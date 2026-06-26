#!/usr/bin/env node
/**
 * Fail CI if the packaged desktop build would apply updates silently (/S).
 * Run after `tsc --build` (local) or `npm run dist` (release — checks dist/).
 *
 * Why: quitAndInstall(true, …) hides NSIS for minutes and breaks shortcuts.
 * The fix must be in the *installed* app before N→N+1 auto-update is tested.
 */
import { existsSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const distAutoUpdate = join(repoRoot, 'apps', 'desktop', 'dist', 'auto-update.js');
const distInstallHandoff = join(repoRoot, 'apps', 'desktop', 'dist', 'install-handoff.js');
const unpackedAutoUpdate = join(
  repoRoot,
  'apps',
  'desktop',
  'dist-installer',
  'win-unpacked',
  'resources',
  'app',
  'dist',
  'auto-update.js',
);

const autoUpdatePath = existsSync(unpackedAutoUpdate) ? unpackedAutoUpdate : distAutoUpdate;

if (!existsSync(autoUpdatePath)) {
  console.error(`verify-update-behavior: missing ${autoUpdatePath} — run tsc --build first`);
  process.exit(1);
}

const source = readFileSync(autoUpdatePath, 'utf8');
const errors = [];

// Compiled TS emits quitAndInstall(false, true) — never silent.
const nonSilentPatterns = [
  /quitAndInstall\s*\(\s*false\s*,\s*true\s*\)/,
  /quitAndInstall\s*\(\s*!1\s*,\s*!0\s*\)/,
];
if (!nonSilentPatterns.some((re) => re.test(source))) {
  errors.push('auto-update.js must call quitAndInstall(false, true) for visible NSIS apply');
}

const silentPatterns = [
  /quitAndInstall\s*\(\s*true\s*,/,
  /quitAndInstall\s*\(\s*!0\s*,/,
];
if (silentPatterns.some((re) => re.test(source))) {
  errors.push('auto-update.js must NOT call quitAndInstall(true, …) — that passes /S to NSIS');
}

if (!/isSilent:\s*false/.test(source)) {
  errors.push('install_quit log must record isSilent: false');
}

if (!/writeInstallHandoff/.test(source)) {
  errors.push('auto-update.js must call writeInstallHandoff before quitAndInstall');
}

if (!/disableDifferentialDownload\s*=\s*true/.test(source)) {
  errors.push('autoUpdater.disableDifferentialDownload must be true');
}

const handoffPath = existsSync(
  autoUpdatePath.includes('win-unpacked')
    ? join(
        repoRoot,
        'apps',
        'desktop',
        'dist-installer',
        'win-unpacked',
        'resources',
        'app',
        'dist',
        'install-handoff.js',
      )
    : distInstallHandoff,
)
  ? autoUpdatePath.replace('auto-update.js', 'install-handoff.js')
  : distInstallHandoff;

if (!existsSync(handoffPath)) {
  errors.push(`missing ${handoffPath}`);
} else {
  const handoffSource = readFileSync(handoffPath, 'utf8');
  if (!/install_handoff/.test(handoffSource) || !/install_complete/.test(handoffSource)) {
    errors.push('install-handoff.js must log install_handoff and install_complete');
  }
}

if (errors.length > 0) {
  console.error('verify-update-behavior: FAILED');
  for (const err of errors) console.error(`  - ${err}`);
  process.exit(1);
}

console.log(`verify-update-behavior: OK (${autoUpdatePath})`);

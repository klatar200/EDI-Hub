#!/usr/bin/env node
/**
 * Issue an Ed25519-signed desktop license key (D8 Sprint 1).
 *
 * Usage:
 *   node apps/desktop/scripts/issue-license-key.mjs \
 *     --private-key /path/to/license-private.pem \
 *     --customer acme-corp \
 *     --tier standard \
 *     --renews-at 2027-06-25
 *
 * The private key must never be committed. Embed only the matching public
 * key in apps/desktop/src/license-public-key.ts.
 */
import { readFileSync } from 'node:fs';
import { encodeLicenseKey } from '../dist/license.js';

function arg(name: string): string | undefined {
  const idx = process.argv.indexOf(name);
  if (idx === -1 || idx + 1 >= process.argv.length) return undefined;
  return process.argv[idx + 1];
}

const privateKeyPath = arg('--private-key');
const customerId = arg('--customer');
const tier = arg('--tier') ?? 'standard';
const renewsAt = arg('--renews-at');

if (!privateKeyPath || !customerId || !renewsAt) {
  console.error(
    'Usage: node issue-license-key.mjs --private-key <pem> --customer <id> --renews-at <ISO-date> [--tier standard]',
  );
  process.exit(1);
}

const privateKeyPem = readFileSync(privateKeyPath, 'utf8');
const key = encodeLicenseKey(
  { customerId, renewsAt: new Date(renewsAt).toISOString(), tier },
  privateKeyPem,
);
console.log(key);

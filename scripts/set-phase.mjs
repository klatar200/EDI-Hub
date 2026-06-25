#!/usr/bin/env node
/**
 * set-phase.mjs
 *
 * Updates the "## Current phase" line in both AI config files from a single
 * source of truth. Run whenever you advance to a new build phase.
 *
 * Usage:
 *   npm run set-phase -- <phase-number>
 *   npm run set-phase -- 2
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');

// ── Phase map ─────────────────────────────────────────────────────────────────
// Each entry is the full phase line injected into both config files.
// Edit these descriptions if the focus of a phase shifts.

const PHASES = {
  0:  'Phase 0 — Scaffolding. Focus: repo setup, CI, dev/staging environments. Do not build features.',
  1:  'Phase 1 — Ingestion Spike. Focus: SFTP/upload ingestion, S3 raw storage, dedup, ingestion logging in apps/api. Do not build the parser or UI.',
  2:  'Phase 2 — X12 Parser & Structured Storage. Focus: envelope + 850/810 parsing in packages/edi-parser; relational schema in packages/db. Do not build API routes or UI.',
  3:  'Phase 3 — Data Hub UI. Focus: transaction list, detail view, raw/parsed toggle, basic search in apps/web.',
  4:  'Phase 4 — Transaction Lifecycle Stitching. Focus: cross-reference linking logic and lifecycle timeline UI.',
  5:  'Phase 5 — 997/999 Acknowledgment Intelligence. Focus: AK segment parsing, error-code dictionary, ack-to-original linkage.',
  6:  'Phase 6 — Trading Partner Configuration. Focus: partner CRUD, SLA windows per transaction type, supported sets per partner.',
  7:  'Phase 7 — Monitoring & Alerting. Focus: BullMQ jobs, missing-ack detection, email/Slack alert delivery.',
  8:  'Phase 8 — Outbound Visibility & Second Ingestion Channel. Focus: outbound state tracking, second ingestion method.',
  9:  'Phase 9 — Multi-Tenancy, Auth & Security Hardening. Focus: tenant isolation, RBAC, SSO, security checklist sign-off.',
  10: 'Phase 10 — Production Readiness. Focus: observability, tested backups, load testing, incident runbooks.',
  11: 'Phase 11 — Commercialization. Focus: Stripe billing, self-serve onboarding, legal docs, landing site.',
  12: 'Phase 12 — Pilot → First External Customer. Focus: design partner recruitment, feedback loop, first paid contract.',
};

// ── Files to patch ─────────────────────────────────────────────────────────────
const FILES = [
  resolve(ROOT, 'AGENT_SYSTEM_MESSAGE.md'),
  resolve(ROOT, '.continue', 'rules', 'claude-directions.md'),
];

// ── Parse args ─────────────────────────────────────────────────────────────────
const phaseArg = process.argv[2];
const phase = parseInt(phaseArg, 10);

if (isNaN(phase) || !(phase in PHASES)) {
  const valid = Object.keys(PHASES).join(', ');
  console.error(`\nUsage: npm run set-phase -- <phase>\nValid phases: ${valid}\n`);
  process.exit(1);
}

const phaseText = PHASES[phase];

// ── Patch each file ─────────────────────────────────────────────────────────────
// Matches the comment line + any existing phase line, replaces the phase line only.
const PHASE_PATTERN = /(<!-- Update this line.*?-->\n)Phase \d+.*/s;

let anyUpdated = false;

for (const filePath of FILES) {
  const rel = filePath.replace(ROOT + '\\', '').replace(ROOT + '/', '');
  let content;

  try {
    content = readFileSync(filePath, 'utf8');
  } catch {
    console.error(`✗ Could not read ${rel}`);
    continue;
  }

  const updated = content.replace(PHASE_PATTERN, `$1${phaseText}`);

  if (updated === content) {
    console.warn(`⚠  No phase line found in ${rel} — skipping.`);
    continue;
  }

  writeFileSync(filePath, updated, 'utf8');
  console.log(`✓ ${rel}`);
  anyUpdated = true;
}

if (anyUpdated) {
  console.log(`\n→ Phase ${phase}: ${phaseText}\n`);
} else {
  console.error('\nNo files were updated. Check that the phase comment block exists in each file.\n');
  process.exit(1);
}

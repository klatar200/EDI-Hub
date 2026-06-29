#!/usr/bin/env node
/**
 * Write apps/desktop/resources/clerk-runtime.json for packaged releases.
 * CI passes Clerk secrets via env; local dev omits the file (hub-mode fallback).
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const outDir = resolve(here, '..', 'apps', 'desktop', 'resources');
const outPath = resolve(outDir, 'clerk-runtime.json');

const payload = {
  publishableKey: process.env.VITE_CLERK_PUBLISHABLE_KEY?.trim() ?? '',
  secretKey: process.env.CLERK_SECRET_KEY?.trim() ?? '',
  webhookSecret: process.env.CLERK_WEBHOOK_SECRET?.trim() ?? '',
  authorizedParties:
    process.env.CLERK_AUTHORIZED_PARTIES?.trim()
    ?? 'http://localhost:3000,http://127.0.0.1:3000',
};

mkdirSync(outDir, { recursive: true });
writeFileSync(outPath, JSON.stringify(payload, null, 2), 'utf8');
console.log(`write-clerk-runtime: wrote ${outPath}`);

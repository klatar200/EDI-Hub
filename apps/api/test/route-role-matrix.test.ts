/**
 * Phase 9 Sprint 6.4 — Route × role enforcement matrix.
 *
 * Builds a bare Fastify instance, attaches an `onRoute` hook to capture
 * every route's declared `config.requiredRole`, then registers the
 * production route plugins. Asserts the captured matrix matches the
 * expected role for each (method, url) tuple.
 *
 * This is the safety net that catches a route that silently dropped its
 * `requiresRole(...)` wrapper during a refactor — the runtime preHandler
 * would then default to "no required role" and quietly weaken the API.
 *
 * Adding a new route: append it to EXPECTED below, with the role you
 * intended to declare. If you genuinely want a route with no role gate
 * (e.g. a public health probe), set the expectation to `null`.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import Fastify from 'fastify';
import multipart from '@fastify/multipart';
import { ingestRoutes } from '../src/routes/ingest.js';
import { healthRoutes } from '../src/routes/health.js';
import { internalRoutes } from '../src/routes/internal.js';
import { transactionRoutes } from '../src/routes/transactions.js';
import { partnerRoutes } from '../src/routes/partners.js';
import { rawFileRoutes } from '../src/routes/raw-files.js';
import { searchRoutes } from '../src/routes/search.js';
import { lifecycleRoutes } from '../src/routes/lifecycle.js';
import { metricsRoutes } from '../src/routes/metrics.js';
import { partnersConfigRoutes } from '../src/routes/partners-config.js';
import { alertsRoutes } from '../src/routes/alerts.js';
import { userRoutes } from '../src/routes/users.js';
import { auditRoutes } from '../src/routes/audit.js';
import { tenantRoutes } from '../src/routes/tenants.js';
import { webhookRoutes } from '../src/routes/webhooks.js';

type Role = 'viewer' | 'ops' | 'admin' | null;

/**
 * Expected requiredRole per route. `null` means "intentionally ungated"
 * (currently /health and /webhooks/clerk — both are publicly reachable,
 * the webhook verifies its own signature inline).
 *
 * Read this list alongside the BUILD_PLAN role policy:
 *   viewer = every GET, ops = ack/snooze + write-state actions on alerts,
 *   admin = partner config + user CRUD + audit log + ingest upload.
 */
const EXPECTED: Record<string, Role> = {
  // Public (no role gate — Phase 10 Sprint 1 added /readiness and /internal/metrics)
  'GET /health': null,
  'GET /readiness': null,
  'GET /internal/metrics': null,
  'POST /webhooks/clerk': null,

  // Viewer reads
  'GET /partners': 'viewer',
  'GET /partners-config': 'viewer',
  'GET /partners-config/:id': 'viewer',
  'GET /transactions': 'viewer',
  'GET /transactions/:id': 'viewer',
  'GET /raw-files/:id/content': 'viewer',
  'GET /search': 'viewer',
  'GET /lifecycle': 'viewer',
  'GET /metrics/rejection-rate': 'viewer',
  'GET /alerts': 'viewer',
  'GET /alerts/:id': 'viewer',
  'GET /me': 'viewer',
  'GET /users': 'viewer',
  'GET /ingest/:id': 'viewer',
  'GET /ingest': 'viewer',

  // Ops actions
  'PATCH /alerts/:id/ack': 'ops',
  'POST /alerts/:id/snooze': 'ops',

  // Admin actions
  'POST /partners-config': 'admin',
  'PATCH /partners-config/:id': 'admin',
  'DELETE /partners-config/:id': 'admin',
  'PATCH /users/:id': 'admin',
  'DELETE /users/:id': 'admin',
  'GET /audit': 'admin',
  'DELETE /tenants/me': 'admin',
  'POST /tenants/me/undelete': 'admin',

  // Ops-only mutating action — file upload is operational, not admin.
  'POST /ingest/upload': 'ops',
};

interface CapturedRoute {
  method: string;
  url: string;
  requiredRole: Role;
}

test('every registered route declares the requiredRole expected by the policy', async () => {
  const app = Fastify({ logger: false });
  // Multipart required by ingest. No other plugin matters for this hook.
  await app.register(multipart, { limits: { fileSize: 1024 * 1024, files: 1 } });

  const captured: CapturedRoute[] = [];
  app.addHook('onRoute', (route) => {
    // Fastify normalizes `method` to string | string[]. We expand arrays so
    // each (method, url) tuple is checked independently.
    const methods = Array.isArray(route.method) ? route.method : [route.method];
    const cfg = route.config as { requiredRole?: Role } | undefined;
    for (const m of methods) {
      // HEAD is auto-registered by Fastify for every GET; skip it — the role
      // policy applies to the GET we declared, not the implicit HEAD.
      if (m === 'HEAD') continue;
      captured.push({
        method: m.toUpperCase(),
        url: route.url,
        requiredRole: cfg?.requiredRole ?? null,
      });
    }
  });

  // Register the exact same route plugins as server.ts, in the same order.
  await app.register(healthRoutes);
  await app.register(internalRoutes);
  await app.register(webhookRoutes);
  await app.register(ingestRoutes);
  await app.register(transactionRoutes);
  await app.register(partnerRoutes);
  await app.register(rawFileRoutes);
  await app.register(searchRoutes);
  await app.register(lifecycleRoutes);
  await app.register(metricsRoutes);
  await app.register(partnersConfigRoutes);
  await app.register(alertsRoutes);
  await app.register(userRoutes);
  await app.register(auditRoutes);
  await app.register(tenantRoutes);

  // Two-way check: every captured route is in EXPECTED, and every EXPECTED
  // route shows up captured. Either side missing is a bug.
  const captureKey = (r: CapturedRoute) => `${r.method} ${r.url}`;
  const capturedMap = new Map(captured.map((r) => [captureKey(r), r.requiredRole]));

  const mismatched: string[] = [];
  const missing: string[] = [];

  for (const [key, expectedRole] of Object.entries(EXPECTED)) {
    if (!capturedMap.has(key)) {
      missing.push(`MISSING (in EXPECTED, not registered): ${key}`);
      continue;
    }
    const actualRole = capturedMap.get(key)!;
    if (actualRole !== expectedRole) {
      mismatched.push(`${key}: expected ${expectedRole ?? 'null'}, got ${actualRole ?? 'null'}`);
    }
  }

  for (const r of captured) {
    const key = captureKey(r);
    if (!(key in EXPECTED)) {
      missing.push(`UNDOCUMENTED (registered, not in EXPECTED): ${key} (declared: ${r.requiredRole ?? 'null'})`);
    }
  }

  await app.close();

  assert.deepEqual(mismatched, [], `Role mismatches:\n  ${mismatched.join('\n  ')}`);
  assert.deepEqual(missing, [], `Route inventory drift:\n  ${missing.join('\n  ')}`);
});

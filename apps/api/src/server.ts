/**
 * Fastify application factory.
 *
 * `buildServer` wires config, the S3 client, the Prisma client, multipart
 * support, and routes, then returns the instance without listening. This makes
 * the app trivially testable via `app.inject(...)`: tests can inject fake S3 /
 * Prisma clients so the full ingestion path runs without real infrastructure.
 * `index.ts` stays responsible only for binding the port.
 */
import Fastify, { type FastifyInstance } from 'fastify';
import cors from '@fastify/cors';
import multipart from '@fastify/multipart';
import fastifyStatic from '@fastify/static';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import type { S3Client } from '@aws-sdk/client-s3';
import type { PrismaClient } from '@prisma/client';
import { getPrisma } from '@edi/db';
import { loadConfig, type AppConfig } from './config.js';
import { createS3Client } from './storage/s3.js';
import { createStorageAdapter } from './storage/factory.js';
import type { StorageAdapter } from './storage/interface.js';
import type { AuthOutcome } from './services/auth.js';
import { ingestRoutes } from './routes/ingest.js';
import { healthRoutes } from './routes/health.js';
import { tenantPlugin } from './plugins/tenant.js';
import { securityHeaders } from './plugins/security-headers.js';
import { observability } from './plugins/observability.js';
import { rateLimit, type RateLimitGroup, type RateLimitConfig } from './plugins/rate-limit.js';
import { internalRoutes } from './routes/internal.js';
import { transactionRoutes } from './routes/transactions.js';
import { partnerRoutes } from './routes/partners.js';
import { rawFileRoutes } from './routes/raw-files.js';
import { searchRoutes } from './routes/search.js';
import { lifecycleRoutes } from './routes/lifecycle.js';
import { metricsRoutes } from './routes/metrics.js';
import { dashboardRoutes } from './routes/dashboard.js';
import { opsRoutes } from './routes/ops.js';
import { partnersConfigRoutes } from './routes/partners-config.js';
import { setupRoutes } from './routes/setup.js';
import { alertsRoutes } from './routes/alerts.js';
import { userRoutes } from './routes/users.js';
import { auditRoutes } from './routes/audit.js';
import { tenantRoutes } from './routes/tenants.js';
import { webhookRoutes } from './routes/webhooks.js';
import type { FastifyRequest } from 'fastify';

export interface BuildServerOptions {
  config?: AppConfig;
  /** Inject a fake/real S3 client. Defaults to one built from config.
   *  When `storage.backend === 'local'` the SaaS-style S3 client is
   *  still constructed (cheap) so backward-compat code paths and tests
   *  that read `app.s3` keep working — the local storage adapter just
   *  never touches it. */
  s3?: S3Client;
  /** Desktop track D3 Sprint 1 - inject a fake StorageAdapter for tests.
   *  Defaults to one built from `config.storage.backend`. */
  storage?: StorageAdapter;
  /** Inject a fake/real Prisma client. Defaults to the shared singleton. */
  prisma?: PrismaClient;
  /** Phase 9 Sprint 2 — inject a fake JWT verifier for auth integration tests.
   *  Default uses the real Clerk SDK (driven by config.clerk.secretKey). */
  verifyAuth?: (
    request: FastifyRequest,
    secretKey: string,
    publishableKey?: string,
    authorizedPartiesEnv?: string,
  ) => Promise<AuthOutcome>;
  /** Phase 10 Sprint 4 — tighten / loosen per-group rate-limit bounds.
   *  Production keeps defaults from `DEFAULT_LIMITS`; tests use this to
   *  set tiny limits and exercise the over-limit path quickly. */
  rateLimits?: Partial<Record<RateLimitGroup, RateLimitConfig>>;
}

export async function buildServer(opts: BuildServerOptions = {}): Promise<FastifyInstance> {
  const config = opts.config ?? loadConfig();

  // Phase 10 Sprint 1.1 — pino serializers strip raw request/reply payloads
  // from log lines. We explicitly do NOT log headers (Authorization),
  // bodies (partner data), or query strings (could contain PO numbers).
  // The observability plugin emits a structured `request` log per response
  // with an allowlisted field set.
  const app = Fastify({
    logger: {
      level: config.nodeEnv === 'test' ? 'silent' : 'info',
      serializers: {
        req: (req: { id?: string; method?: string; url?: string }) => ({
          // Only the allowlisted shape — headers and body are dropped.
          reqId: req.id,
          method: req.method,
          // Strip query string to keep PO numbers out of logs.
          url: req.url ? req.url.split('?')[0] : undefined,
        }),
        res: (res: { statusCode?: number }) => ({ statusCode: res.statusCode }),
      },
    },
    // Trust forwarded headers once behind a load balancer (AWS ALB later).
    trustProxy: true,
    // Phase 10 Sprint 4.2 — global JSON body cap (25 KB). Webhook bodies
    // are small; partner-config writes are small. Multipart uploads bypass
    // this — `@fastify/multipart`'s own `fileSize` limit governs them
    // (set to `config.maxFileSizeBytes` below).
    bodyLimit: 25 * 1024,
  });

  app.decorate('config', config);
  const s3Client = opts.s3 ?? createS3Client(config.s3);
  app.decorate('s3', s3Client);
  // D3 Sprint 1 - every read/write of a raw file goes through this adapter.
  app.decorate(
    'storage',
    opts.storage ?? createStorageAdapter(config, s3Client),
  );
  // Only construct the real Prisma client when one isn't injected, so tests
  // never touch a database.
  app.decorate('prisma', opts.prisma ?? getPrisma());

  // Desktop track D4 Sprint 1 — CORS for cross-origin requests from the
  // Electron renderer to the API child. Closed by default in cloud / pure-
  // web dev (Vite proxy keeps requests same-origin); the desktop main
  // process sets CORS_ALLOWED_ORIGINS so the plugin loads with an allowlist.
  //
  // Registered BEFORE the tenant/auth plugin so preflight OPTIONS requests
  // get answered without going through Clerk verification (which would
  // reject them — there's no Bearer token on a preflight).
  if (config.cors.allowedOrigins.length > 0) {
    const allowed = new Set(config.cors.allowedOrigins);
    await app.register(cors, {
      // `origin` callback runs per-request: allow no-origin (same-origin /
      // health probes from main process) and any explicitly allowlisted
      // value. We intentionally do NOT use the array form because that
      // sends the header back as a literal '*', which breaks credentialed
      // requests (Authorization: Bearer ...).
      origin: (origin, cb) => {
        if (!origin) return cb(null, true);
        cb(null, allowed.has(origin));
      },
      credentials: true,
      methods: ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS'],
      allowedHeaders: ['Authorization', 'Content-Type'],
    });
  }

  await app.register(multipart, {
    limits: { fileSize: config.maxFileSizeBytes, files: 1 },
    throwFileSizeLimit: false, // we detect truncation explicitly and return 413
  });

  // Phase 9 Sprint 5 — HSTS + defensive headers on every response, including
  // /health, so we never serve a response that allows a future HTTP downgrade.
  await app.register(securityHeaders);

  // Phase 10 Sprint 1 — request metrics + structured per-response log.
  // Registered before route plugins so the onRequest/onResponse hooks
  // fire for every route, including /health and /internal/metrics.
  await app.register(observability);

  // Phase 9 Sprint 2 — auth + tenant context. Verifies the Clerk JWT and
  // populates `request.auth` + tenant context on every non-public route.
  // Tests can override `verify` to short-circuit JWT verification.
  await app.register(tenantPlugin, { verify: opts.verifyAuth });

  // Phase 10 Sprint 4 — per-tenant token-bucket rate limit. Registers a
  // preHandler hook so it runs AFTER the tenant plugin populates
  // request.tenantId. The audit row (rate.exceeded) is best-effort.
  await app.register(rateLimit, { limits: opts.rateLimits });

  // Public routes (no auth):
  await app.register(healthRoutes);
  // Phase 10 Sprint 1 — /internal/metrics + /readiness are public so the
  // ALB target group + Prometheus scraper don't need a JWT. The tenant
  // plugin treats them as public via PUBLIC_ROUTES below.
  await app.register(internalRoutes);
  // Webhook signature is verified inside the route; the tenant plugin treats
  // /webhooks/clerk as public.
  await app.register(webhookRoutes);

  // Desktop track D4 Sprint 2 — every authenticated route lives under
  // /api. This decouples the API surface from the React app's routes
  // (which live at /) so the LAN-server install can serve both from a
  // single port. Pre-Sprint-2 the SaaS deployment relied on the Vite
  // proxy stripping /api; that rewrite is now reversed (the proxy
  // forwards /api/* verbatim) so the same code path serves cloud,
  // desktop, and dev.
  await app.register(
    async (apiScope) => {
      await apiScope.register(ingestRoutes);
      await apiScope.register(transactionRoutes);
      await apiScope.register(partnerRoutes);
      await apiScope.register(rawFileRoutes);
      await apiScope.register(searchRoutes);
      await apiScope.register(lifecycleRoutes);
      await apiScope.register(metricsRoutes);
      await apiScope.register(dashboardRoutes);
      await apiScope.register(opsRoutes);
      await apiScope.register(partnersConfigRoutes);
      await apiScope.register(setupRoutes);
      await apiScope.register(alertsRoutes);
      await apiScope.register(userRoutes);
      await apiScope.register(auditRoutes);
      await apiScope.register(tenantRoutes);
    },
    { prefix: '/api' },
  );

  // Desktop track D4 Sprint 2 — when WEB_STATIC_DIR is set, serve the
  // React build from `/`. Registered LAST so it never intercepts
  // /api/* or /health/etc. The SPA fallback below catches any non-asset
  // path (e.g. /dashboard, /transactions/abc) and returns index.html so
  // client-side React Router routes resolve on direct URL hits.
  if (config.webStatic.dir.length > 0) {
    const staticRoot = resolve(config.webStatic.dir);
    if (!existsSync(staticRoot)) {
      throw new Error(
        `WEB_STATIC_DIR='${staticRoot}' does not exist. Run \`npm run build -w @edi/web\` first.`,
      );
    }
    await app.register(fastifyStatic, {
      root: staticRoot,
      // Don't auto-attach a wildcard 404 handler — we do our own SPA
      // fallback below so React Router paths return index.html.
      wildcard: false,
    });
    // SPA fallback. Order matters: this runs AFTER fastify-static's
    // file-matching, so real assets (/assets/foo.js, /favicon.ico) still
    // resolve correctly. Anything else that GETs / falls through here.
    app.setNotFoundHandler(async (request, reply) => {
      // Only fall back for GET requests to non-API paths. POSTs and
      // /api/* 404s should still return a proper 404 (so the renderer
      // surfaces "route not found" errors instead of an HTML payload).
      if (request.method !== 'GET' || request.url.startsWith('/api/')) {
        return reply.code(404).send({ error: 'NOT_FOUND' });
      }
      return reply.type('text/html').sendFile('index.html');
    });
  }

  return app;
}

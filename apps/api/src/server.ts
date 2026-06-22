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
import multipart from '@fastify/multipart';
import type { S3Client } from '@aws-sdk/client-s3';
import type { PrismaClient } from '@prisma/client';
import { getPrisma } from '@edi/db';
import { loadConfig, type AppConfig } from './config.js';
import { createS3Client } from './storage/s3.js';
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
import { partnersConfigRoutes } from './routes/partners-config.js';
import { alertsRoutes } from './routes/alerts.js';
import { userRoutes } from './routes/users.js';
import { auditRoutes } from './routes/audit.js';
import { tenantRoutes } from './routes/tenants.js';
import { webhookRoutes } from './routes/webhooks.js';
import type { FastifyRequest } from 'fastify';

export interface BuildServerOptions {
  config?: AppConfig;
  /** Inject a fake/real S3 client. Defaults to one built from config. */
  s3?: S3Client;
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
  app.decorate('s3', opts.s3 ?? createS3Client(config.s3));
  // Only construct the real Prisma client when one isn't injected, so tests
  // never touch a database.
  app.decorate('prisma', opts.prisma ?? getPrisma());

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

  // Authenticated routes:
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

  return app;
}

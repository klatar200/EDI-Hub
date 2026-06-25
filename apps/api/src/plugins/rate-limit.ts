/**
 * Phase 10 Sprint 4 — In-memory token-bucket rate limit.
 *
 * Why in-house rather than @fastify/rate-limit:
 *   - We need per-(tenant, group) buckets, not just per-IP — and the
 *     plugin's API for that is awkward.
 *   - We want the over-limit event in our audit log via `withAudit`'s
 *     transaction client, which requires direct access to `prisma`.
 *   - The behaviour is ~80 lines and the test surface is finite.
 *
 * One token bucket per (key, group). Key is `request.tenantId` for
 * authenticated routes, falling back to `request.ip` for public routes
 * (/health, /readiness, /webhooks/clerk). Groups:
 *
 *   read     600/min   — every GET on authenticated routes.
 *   write    60/min    — POST/PATCH/DELETE on authenticated routes.
 *   ingest   10/min    — POST /ingest/upload (tighter; multipart is expensive).
 *   webhook  60/min    — POST /webhooks/clerk, keyed by IP.
 *
 * Buckets are in-process. With a single API task this is exact; with
 * multiple tasks behind the ALB each task enforces independently, so the
 * effective limit per tenant is N * configured limit. That's acceptable
 * for v1 (the ALB-level WAF + ECS scaling cap are the broader brakes);
 * Redis-backed shared buckets land if we ever see organized abuse.
 *
 * Memory: capped at 10k keys per group via LRU eviction so a parade of
 * unauthenticated IPs can't OOM the process.
 */
import type { FastifyInstance, FastifyPluginOptions, FastifyRequest, FastifyReply } from 'fastify';
import fp from 'fastify-plugin';
import type { PrismaClient } from '@prisma/client';
import { tenantContext } from '@edi/db';
import { emitAudit } from '../services/audit.js';

export type RateLimitGroup = 'read' | 'write' | 'ingest' | 'webhook';

export interface RateLimitConfig {
  /** Tokens per minute per (key, group). */
  perMinute: number;
  /** Bucket size — controls burst capacity. Defaults to perMinute. */
  burst?: number;
}

export const DEFAULT_LIMITS: Record<RateLimitGroup, RateLimitConfig> = {
  read:    { perMinute: 600 },
  write:   { perMinute: 60 },
  ingest:  { perMinute: 10 },
  webhook: { perMinute: 60 },
};

interface Bucket {
  tokens: number;
  /** Last refill timestamp (ms since epoch). */
  lastRefillMs: number;
  /** Last access timestamp — used for LRU eviction. */
  lastUsedMs: number;
}

const MAX_KEYS_PER_GROUP = 10_000;

/** Per-group bucket store. Module-scoped so the plugin survives the
 *  process lifecycle and tests can reset via the exported helper. */
const stores: Record<RateLimitGroup, Map<string, Bucket>> = {
  read: new Map(),
  write: new Map(),
  ingest: new Map(),
  webhook: new Map(),
};

/** Reset every bucket — test-only. */
export function resetRateLimits(): void {
  for (const g of Object.keys(stores) as RateLimitGroup[]) stores[g].clear();
}

/** Token-bucket take-one with refill since last access. Returns
 *  `{ allowed, remaining, retryAfterSeconds }`. */
function takeToken(
  group: RateLimitGroup,
  key: string,
  cfg: RateLimitConfig,
  nowMs = Date.now(),
): { allowed: boolean; remaining: number; retryAfterSeconds: number } {
  const burst = cfg.burst ?? cfg.perMinute;
  const refillRatePerMs = cfg.perMinute / 60_000;
  const store = stores[group];

  let bucket = store.get(key);
  if (!bucket) {
    // New key — start at full bucket. Evict the LRU entry if we've hit
    // the per-group cap (cheap O(n) scan; only fires at capacity).
    if (store.size >= MAX_KEYS_PER_GROUP) {
      let lruKey: string | undefined;
      let lruTs = Infinity;
      for (const [k, b] of store) {
        if (b.lastUsedMs < lruTs) { lruTs = b.lastUsedMs; lruKey = k; }
      }
      if (lruKey !== undefined) store.delete(lruKey);
    }
    bucket = { tokens: burst, lastRefillMs: nowMs, lastUsedMs: nowMs };
    store.set(key, bucket);
  } else {
    // Refill since last access, capped at burst.
    const elapsedMs = nowMs - bucket.lastRefillMs;
    if (elapsedMs > 0) {
      bucket.tokens = Math.min(burst, bucket.tokens + elapsedMs * refillRatePerMs);
      bucket.lastRefillMs = nowMs;
    }
    bucket.lastUsedMs = nowMs;
  }

  if (bucket.tokens >= 1) {
    bucket.tokens -= 1;
    return { allowed: true, remaining: Math.floor(bucket.tokens), retryAfterSeconds: 0 };
  }
  // Tokens < 1 — compute seconds until 1 token refills.
  const secondsUntilOne = (1 - bucket.tokens) / refillRatePerMs / 1000;
  return {
    allowed: false,
    remaining: 0,
    retryAfterSeconds: Math.max(1, Math.ceil(secondsUntilOne)),
  };
}

/** Classify the route into a group. Driven by the route's URL pattern +
 *  HTTP method, NOT by an explicit per-route declaration — we want
 *  every new route to fall into a sensible default automatically. */
function classify(request: FastifyRequest): RateLimitGroup | null {
  const url = request.routeOptions.url ?? '';
  if (url === '/webhooks/clerk') return 'webhook';
  // /health, /readiness, /internal/metrics — no rate limit. Health probes
  // need to be fast and frequent; metrics scrapes too.
  if (url === '/health' || url === '/readiness' || url === '/internal/metrics') return null;
  // D4 Sprint 2 — authenticated routes are now mounted under /api.
  // routeOptions.url is the path as registered (after the plugin prefix
  // is applied by Fastify), so the ingest upload route reads as
  // `/api/ingest/upload` here.
  if (url === '/api/ingest/upload') return 'ingest';
  const method = request.method.toUpperCase();
  if (method === 'GET' || method === 'HEAD') return 'read';
  return 'write';
}

/** Bucket key — tenant-scoped when we have an auth context, otherwise
 *  client-IP-scoped (webhook + dev-fallback fall through here). */
function bucketKey(request: FastifyRequest): string {
  if (request.tenantId) return `tenant:${request.tenantId}`;
  return `ip:${request.ip}`;
}

interface RateLimitPluginOptions extends FastifyPluginOptions {
  /** Override per-group limits — tests use this to set tight bounds. */
  limits?: Partial<Record<RateLimitGroup, RateLimitConfig>>;
  /** Inject a clock for deterministic tests. */
  now?: () => number;
  /** Best-effort audit on over-limit. Default uses the app's Prisma. */
  audit?: (request: FastifyRequest, group: RateLimitGroup, key: string) => Promise<void>;
}

async function rateLimitImpl(
  app: FastifyInstance,
  opts: RateLimitPluginOptions,
): Promise<void> {
  const limits: Record<RateLimitGroup, RateLimitConfig> = {
    read:    opts.limits?.read ?? DEFAULT_LIMITS.read,
    write:   opts.limits?.write ?? DEFAULT_LIMITS.write,
    ingest:  opts.limits?.ingest ?? DEFAULT_LIMITS.ingest,
    webhook: opts.limits?.webhook ?? DEFAULT_LIMITS.webhook,
  };
  const now = opts.now ?? Date.now;
  const audit = opts.audit ?? defaultAudit;

  // preHandler — after tenant auth has run, before the route handler.
  // Choosing preHandler over onRequest means request.tenantId is already
  // set, so authenticated buckets are correctly tenant-scoped.
  app.addHook('preHandler', async (request: FastifyRequest, reply: FastifyReply) => {
    const group = classify(request);
    if (group === null) return; // /health, /readiness, /internal/metrics

    const key = bucketKey(request);
    const result = takeToken(group, key, limits[group], now());

    // Always expose the remaining budget so the caller can self-throttle.
    reply.header('X-RateLimit-Limit', String(limits[group].perMinute));
    reply.header('X-RateLimit-Remaining', String(result.remaining));
    reply.header('X-RateLimit-Group', group);

    if (result.allowed) return;

    reply.header('Retry-After', String(result.retryAfterSeconds));
    // Fire-and-forget audit. Don't await — the 429 response must stay
    // cheap, otherwise a determined client can use audit-DB pressure to
    // amplify their own load.
    void audit(request, group, key);

    return reply.code(429).send({
      error: {
        code: 'RATE_LIMITED',
        message: `Too many ${group} requests; retry after ${result.retryAfterSeconds}s.`,
        retryAfterSeconds: result.retryAfterSeconds,
      },
    });
  });
}

/** Default audit emitter — writes a rate.exceeded row scoped to the
 *  request's tenant (or an `ip:` pseudo-tenant for unauthenticated). */
async function defaultAudit(
  request: FastifyRequest,
  group: RateLimitGroup,
  key: string,
): Promise<void> {
  // No tenant context, no audit — unauthenticated abuse is logged in
  // CloudWatch (the structured request log already carries IP + route).
  if (!request.tenantId) return;
  try {
    const prisma = (request.server as unknown as { prisma: PrismaClient }).prisma;
    // Use the existing tenant context (set by the tenant plugin earlier
    // in this request's lifecycle) so the audit row carries the right id.
    await tenantContext.run({ tenantId: request.tenantId }, async () => {
      await emitAudit(prisma, {
        action: 'rate.exceeded',
        targetType: 'system',
        targetId: request.tenantId!,
        actorId: request.auth?.userId ?? null,
        payloadDiff: {
          after: {
            group,
            key,
            route: request.routeOptions.url ?? request.url,
            method: request.method,
          },
        },
      });
    });
  } catch (err) {
    // Best-effort: a failing audit must not block the 429.
    request.log.warn({ err }, 'rate-limit: failed to write audit row');
  }
}

export const rateLimit = fp(rateLimitImpl, { name: 'rate-limit' });

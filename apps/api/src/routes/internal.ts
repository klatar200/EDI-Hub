/**
 * Phase 10 Sprint 1 — Internal observability routes.
 *
 *   GET /internal/metrics  → Prometheus exposition format. VPC-only.
 *   GET /readiness         → 200 when DB + S3 + channels healthy, 503 otherwise.
 *
 * /readiness is what the ALB target group should hit; /health (defined in
 * routes/health.ts) is the process-liveness probe ECS uses to decide
 * whether to restart the container. The split lets a slow DB show up as
 * "remove from rotation" (readiness) without "restart the process"
 * (liveness) — the conventional Kubernetes / ECS pattern.
 *
 * /internal/* is documented as VPC-only — the ALB security group must
 * not route `/internal/*` from the public listener. The tenant plugin
 * treats /internal/metrics as a public route (no auth) to keep scrape
 * traffic cheap; same for /readiness so health-checks don't need a JWT.
 */
import { HeadBucketCommand } from '@aws-sdk/client-s3';
import type { FastifyInstance, FastifyPluginOptions } from 'fastify';
import { tenantContext } from '@edi/db';
import type { ChannelHealth } from '../channels/types.js';
import { metrics, renderMetrics } from '../observability/metrics.js';

interface ReadinessResponse {
  status: 'ready' | 'not-ready';
  db: 'connected' | 'error';
  s3: 'reachable' | 'error';
  channels: ChannelHealth[];
}

export async function internalRoutes(
  app: FastifyInstance,
  _opts: FastifyPluginOptions,
): Promise<void> {
  app.get('/internal/metrics', async (_request, reply) => {
    // Refresh the channel-up gauges every scrape so a channel that
    // errored out shows up immediately (not at the next request-driven
    // metric update).
    const health = app.channels?.health() ?? [];
    for (const c of health) {
      metrics.ingestionChannelUp.set(c.status === 'running' ? 1 : 0, {
        channel: c.name,
        source: c.source ?? 'unknown',
      });
    }
    return reply
      .code(200)
      // OpenMetrics 1.0.0 content type — Prometheus + Grafana + Datadog
      // all accept this.
      .header('content-type', 'application/openmetrics-text; version=1.0.0; charset=utf-8')
      .send(renderMetrics());
  });

  app.get('/readiness', async (request, reply) => {
    let db: ReadinessResponse['db'] = 'connected';
    let s3: ReadinessResponse['s3'] = 'reachable';

    try {
      await tenantContext.bypass(() => app.prisma.rawFile.count());
    } catch (err) {
      db = 'error';
      request.log.error({ err }, 'Readiness: database unreachable');
    }
    try {
      await app.s3.send(new HeadBucketCommand({ Bucket: app.config.s3.bucket }));
    } catch (err) {
      s3 = 'error';
      request.log.error({ err }, 'Readiness: S3 unreachable');
    }

    const channels = app.channels?.health() ?? [];
    // Channels not running is "degraded" not "not-ready" — the HTTP upload
    // path still works, and channels are optional. DB or S3 failing IS
    // not-ready: nothing useful can happen.
    const ready = db === 'connected' && s3 === 'reachable';
    const body: ReadinessResponse = {
      status: ready ? 'ready' : 'not-ready',
      db,
      s3,
      channels,
    };
    return reply.code(ready ? 200 : 503).send(body);
  });
}

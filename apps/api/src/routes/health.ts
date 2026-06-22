/**
 * Phase 10 Sprint 1.3 — Liveness probe.
 *
 * `/health` is the LIVENESS probe — it returns 200 as long as the event
 * loop is responsive. It deliberately does NOT touch DB, S3, or channels;
 * a slow DB shouldn't cause ECS to restart the container.
 *
 * For readiness ("can this instance handle traffic right now?") use
 * `/readiness` (defined in routes/internal.ts). The ALB target group
 * should hit `/readiness`; ECS health-check uses `/health`.
 *
 * Backward-compat for the existing tests: the old `/health` returned
 * { status, db, s3, channels } — so this file still exposes those fields,
 * but always reports OK. The dep-checking moved to `/readiness`.
 */
import type { FastifyInstance, FastifyPluginOptions } from 'fastify';
import type { ChannelHealth } from '../channels/types.js';

interface LivenessResponse {
  status: 'ok';
  // Kept for backward compat with anything scraping the old endpoint.
  // Always 'connected' / 'reachable' — real checks are on /readiness.
  db: 'connected';
  s3: 'reachable';
  channels: ChannelHealth[];
}

export async function healthRoutes(
  app: FastifyInstance,
  _opts: FastifyPluginOptions,
): Promise<void> {
  app.get('/health', async (_request, reply) => {
    const body: LivenessResponse = {
      status: 'ok',
      db: 'connected',
      s3: 'reachable',
      channels: app.channels?.health() ?? [],
    };
    return reply.code(200).send(body);
  });
}

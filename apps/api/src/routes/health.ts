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
 * SEC-M3 — public `/health` returns only `{ status: 'ok' }`. Channel
 * paths, LAN IPs, and dependency detail live on `/readiness` (VPC/ALB)
 * or `GET /api/setup` (authenticated desktop admins).
 */
import type { FastifyInstance, FastifyPluginOptions } from 'fastify';

interface LivenessResponse {
  status: 'ok';
}

export async function healthRoutes(
  app: FastifyInstance,
  _opts: FastifyPluginOptions,
): Promise<void> {
  app.get('/health', async (_request, reply) => {
    const body: LivenessResponse = { status: 'ok' };
    return reply.code(200).send(body);
  });
}

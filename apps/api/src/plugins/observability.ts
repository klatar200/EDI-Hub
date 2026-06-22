/**
 * Phase 10 Sprint 1 — Observability plugin.
 *
 * Wires three things into every request:
 *   1. http_in_flight_requests gauge (onRequest +1, onResponse -1).
 *   2. http_requests_total counter (onResponse, labeled route/method/status).
 *   3. http_request_duration_seconds histogram (onResponse).
 *
 * Also emits a structured per-request log line via Fastify's built-in
 * logger — the serializer is configured in server.ts so this plugin
 * just enriches with the fields the serializer expects.
 *
 * Labels are deliberately bounded:
 *   - `route` is the registered URL pattern (e.g. `/partners-config/:id`),
 *     NOT the raw URL — keeps cardinality finite so Prometheus is happy.
 *   - `tenantId` is NOT a metric label (cardinality would explode with
 *     thousands of tenants). It appears in log lines only.
 */
import type { FastifyInstance, FastifyPluginOptions } from 'fastify';
import fp from 'fastify-plugin';
import { metrics } from '../observability/metrics.js';

declare module 'fastify' {
  interface FastifyRequest {
    /** Set by this plugin's onRequest hook — the high-resolution start
     *  time used by the duration histogram and the request log line. */
    _startNs?: bigint;
  }
}

async function observabilityImpl(
  app: FastifyInstance,
  _opts: FastifyPluginOptions,
): Promise<void> {
  app.addHook('onRequest', async (request) => {
    request._startNs = process.hrtime.bigint();
    metrics.httpInFlightRequests.inc();
  });

  app.addHook('onResponse', async (request, reply) => {
    metrics.httpInFlightRequests.dec();
    // `routeOptions.url` is the registered pattern (`/partners-config/:id`).
    // Falling back to the raw URL would explode label cardinality on UUIDs.
    const route = request.routeOptions.url ?? 'unmatched';
    const method = request.method;
    const status = String(reply.statusCode);
    metrics.httpRequestsTotal.inc({ route, method, status });

    if (request._startNs !== undefined) {
      const durationNs = process.hrtime.bigint() - request._startNs;
      const durationSeconds = Number(durationNs) / 1e9;
      metrics.httpRequestDurationSeconds.observe(durationSeconds, { route, method });
      // Structured request log — pino renders this as one JSON line per
      // request. The custom serializer in server.ts pulls these fields.
      request.log.info({
        reqId: request.id,
        tenantId: request.tenantId ?? null,
        route,
        method,
        status: reply.statusCode,
        latencyMs: Math.round(durationSeconds * 1000),
      }, 'request');
    }
  });
}

export const observability = fp(observabilityImpl, { name: 'observability' });

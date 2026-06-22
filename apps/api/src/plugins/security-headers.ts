/**
 * Phase 9 Sprint 5 — Security response headers.
 *
 * The ALB terminates TLS and forwards every request to the API over HTTP
 * inside the VPC. To make sure browsers refuse to fall back to HTTP for
 * future requests, the API emits `Strict-Transport-Security` on every
 * response. HSTS only takes effect once the browser has seen it over an
 * HTTPS connection, which it will because the ALB redirects 80 → 443.
 *
 * Additional defensive headers (X-Content-Type-Options, Referrer-Policy)
 * are cheap to add and reduce browser-side attack surface for the UI's
 * cached responses.
 */
import type { FastifyInstance, FastifyPluginOptions } from 'fastify';
import fp from 'fastify-plugin';

/** 6 months — long enough to be useful, short enough to back out if needed. */
const HSTS_MAX_AGE_SECONDS = 60 * 60 * 24 * 180;

async function securityHeadersImpl(
  app: FastifyInstance,
  _opts: FastifyPluginOptions,
): Promise<void> {
  app.addHook('onSend', async (_request, reply, payload) => {
    // includeSubDomains is safe — we don't run an HTTPS-less subdomain on
    // the same registrable domain. `preload` is intentionally omitted until
    // we're ready to submit to the HSTS preload list (one-way change).
    reply.header(
      'Strict-Transport-Security',
      `max-age=${HSTS_MAX_AGE_SECONDS}; includeSubDomains`,
    );
    reply.header('X-Content-Type-Options', 'nosniff');
    reply.header('Referrer-Policy', 'no-referrer');
    return payload;
  });
}

export const securityHeaders = fp(securityHeadersImpl, { name: 'security-headers' });

// SEC-3 / Phase 10 — rate-limit abuse profile.
//
// Hammers a read endpoint until the per-tenant bucket returns 429, then
// verifies Retry-After + X-RateLimit-* headers. Run against local API or
// staging after minting a JWT.
//
// Local (dev-fallback — no Bearer needed if CLERK_SECRET_KEY is blank):
//   k6 run -e BASE_URL=http://localhost:3000 ops/load/k6/abuse-rate-limit.js
//
// Staging (Clerk JWT required):
//   k6 run -e BASE_URL=https://app.staging.edihub.example.com \
//          -e BEARER=<jwt> \
//          ops/load/k6/abuse-rate-limit.js
//
// Exit code is non-zero if no 429 was observed (bucket too loose or script
// misconfigured). After a staging run, confirm a `rate.exceeded` audit row
// for the tenant in Admin → Audit log.

import http from 'k6/http';
import { check } from 'k6';
import { Counter } from 'k6/metrics';

const BASE_URL = __ENV.BASE_URL || 'http://localhost:3000';
const BEARER = __ENV.BEARER || '';
// Default read bucket is 600/min — send enough iterations to exceed burst.
const ITERATIONS = Number(__ENV.ITERATIONS || '650');

const rateLimited = new Counter('rate_limited_429');

export const options = {
  scenarios: {
    abuse: {
      executor: 'shared-iterations',
      vus: 10,
      iterations: ITERATIONS,
      maxDuration: '60s',
    },
  },
  thresholds: {
    rate_limited_429: ['count > 0'],
    checks: ['rate > 0.95'],
  },
};

const headers = {
  Accept: 'application/json',
  ...(BEARER ? { Authorization: `Bearer ${BEARER}` } : {}),
};

export default function () {
  const res = http.get(`${BASE_URL}/api/partners-config`, { headers, tags: { kind: 'read' } });

  if (res.status === 429) {
    rateLimited.add(1);
    check(res, {
      '429 has Retry-After': (r) => r.headers['Retry-After'] !== undefined && r.headers['Retry-After'] !== '',
      '429 has X-RateLimit-Group': (r) => r.headers['X-RateLimit-Group'] === 'read',
      '429 body is RATE_LIMITED': (r) => {
        try {
          const body = JSON.parse(r.body);
          return body?.error?.code === 'RATE_LIMITED';
        } catch {
          return false;
        }
      },
    });
    return;
  }

  check(res, {
    'under cap is 2xx': (r) => r.status >= 200 && r.status < 300,
    'has rate limit headers': (r) =>
      r.headers['X-RateLimit-Limit'] !== undefined && r.headers['X-RateLimit-Remaining'] !== undefined,
  });
}

export function handleSummary(data) {
  const limited = data.metrics.rate_limited_429?.values?.count ?? 0;
  return {
    stdout: `abuse-rate-limit: observed ${limited} rate-limited (429) responses\n`,
  };
}

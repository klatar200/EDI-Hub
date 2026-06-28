// Phase 10 Sprint 5.1 — read-path load profile.
//
// Run:
//   k6 run -e BASE_URL=https://api.staging.edihub.example.com \
//          -e BEARER=<jwt> \
//          -e PO_NUMBER=PO-12345 \
//          -e INVOICE_NUMBER=INV-9001 \
//          -e PARTNER_ID=SYSCO-LIVE \
//          ops/load/k6/read.js
//
// Gate E (Phase 10 §Locked decision gates):
//   - 100 req/s sustained
//   - p95 < 500 ms on read endpoints
//   - error rate < 1%
//
// Default profile ramps to 50 VUs (~50–80 req/s with our routes' latency
// envelope) over 60 s, holds for 60 s, ramps down. Bump VUs via -e VUS=N
// once the baseline is stable and you want headroom verification.

import http from 'k6/http';
import { check, sleep, fail } from 'k6';
import { Trend, Counter } from 'k6/metrics';

const BASE_URL = __ENV.BASE_URL || fail('Set BASE_URL');
const BEARER   = __ENV.BEARER   || fail('Set BEARER (a real Clerk JWT for the load-test tenant)');
// Optional fixtures — if unset, the script skips that route family.
// Pass real values from your staging tenant.
const PO_NUMBER      = __ENV.PO_NUMBER      || '';
const INVOICE_NUMBER = __ENV.INVOICE_NUMBER || '';
const PARTNER_ID     = __ENV.PARTNER_ID     || '';
const VUS            = Number(__ENV.VUS || '50');

export const options = {
  scenarios: {
    reads: {
      executor: 'ramping-vus',
      startVUs: 0,
      stages: [
        { duration: '60s', target: VUS }, // ramp up
        { duration: '60s', target: VUS }, // hold
        { duration: '30s', target: 0  }, // ramp down
      ],
      gracefulRampDown: '10s',
    },
  },
  thresholds: {
    // Gate E targets — k6 exits non-zero if any threshold fails, so CI/CD
    // can wire this into a pre-deploy check later.
    'http_req_duration{kind:read}': ['p(95) < 500'],
    'http_req_failed':              ['rate < 0.01'],
  },
};

const readDuration = new Trend('read_duration_ms', true);
const skipped      = new Counter('skipped_requests');

const headers = {
  Authorization: `Bearer ${BEARER}`,
  'Content-Type': 'application/json',
  Accept: 'application/json',
};

// Each VU picks one of the read routes per iteration with a small
// distribution. Roughly mirrors the lifecycle UI's traffic shape: most
// loads pull the lifecycle view, a smaller share lists transactions or
// does free-text search.
const ROUTES = [
  { name: 'lifecycle', weight: 0.55 },
  { name: 'transactions-list', weight: 0.30 },
  { name: 'search', weight: 0.10 },
  { name: 'partners-list', weight: 0.05 },
];

function pickRoute() {
  const r = Math.random();
  let acc = 0;
  for (const route of ROUTES) {
    acc += route.weight;
    if (r < acc) return route.name;
  }
  return ROUTES[ROUTES.length - 1].name;
}

export default function () {
  const route = pickRoute();
  let res;
  let url;
  switch (route) {
    case 'lifecycle':
      if (!PO_NUMBER) { skipped.add(1); sleep(1); return; }
      url = `${BASE_URL}/api/lifecycle?po=${encodeURIComponent(PO_NUMBER)}`;
      break;
    case 'transactions-list':
      url = `${BASE_URL}/api/transactions${PARTNER_ID ? `?partner=${encodeURIComponent(PARTNER_ID)}` : ''}`;
      break;
    case 'search':
      url = `${BASE_URL}/api/search?q=${encodeURIComponent(PO_NUMBER || INVOICE_NUMBER || 'PO-')}`;
      break;
    case 'partners-list':
      url = `${BASE_URL}/api/partners-config`;
      break;
  }

  res = http.get(url, { headers, tags: { kind: 'read', route } });
  readDuration.add(res.timings.duration, { route });
  check(res, {
    'status is 2xx': (r) => r.status >= 200 && r.status < 300,
    'has body':     (r) => typeof r.body === 'string' && r.body.length > 0,
  });

  // Mimic UI think time so we're not pegging the API in a hot loop.
  sleep(0.5 + Math.random());
}

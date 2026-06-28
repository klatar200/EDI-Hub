// Phase 10 Sprint 5.2 — ingest-path load profile.
//
// Run:
//   k6 run -e BASE_URL=https://api.staging.edihub.example.com \
//          -e BEARER=<jwt> \
//          ops/load/k6/ingest.js
//
// Each iteration rewrites the ISA control number so dedupe (Phase 1)
// doesn't reject every upload after the first. Without that rewrite the
// run would be a single-success / N-DUPLICATE cliff and we'd be load-
// testing the rejection path instead of the parser.
//
// Gate E:
//   - 10 ingestions/s
//   - p95 < 2 s
//   - error rate < 5%

import http from 'k6/http';
import { check, fail } from 'k6';
import { Trend } from 'k6/metrics';

const BASE_URL = __ENV.BASE_URL || fail('Set BASE_URL');
const BEARER   = __ENV.BEARER   || fail('Set BEARER (admin role required for /ingest/upload? operator role works too)');
const VUS      = Number(__ENV.VUS || '5');

export const options = {
  scenarios: {
    ingest: {
      executor: 'constant-vus',
      vus: VUS,
      duration: '60s',
    },
  },
  thresholds: {
    'http_req_duration{kind:ingest}': ['p(95) < 2000'],
    'http_req_failed':                ['rate < 0.05'],
  },
};

const ingestDuration = new Trend('ingest_duration_ms', true);

// Small 850 fixture. Real-world files are 5–50 KB; this stays close to
// the lower end so we measure the parser + S3 path, not the wire copy.
//
// ISA control number (positions 90-99 inside ISA) is filled in per
// request below — `ISACTL_XX` is the placeholder.
//
// Delimiters: `*` element, `:` sub-element, `~` segment.
const ENVELOPE_TEMPLATE = [
  'ISA*00*          *00*          *ZZ*K6LOAD         *ZZ*OURIDLIVE      *260701*0000*U*00401*ISACTL_XX*0*P*:~',
  'GS*PO*K6LOAD*OURIDLIVE*20260701*0000*1*X*004010~',
  'ST*850*0001~',
  'BEG*00*SA*PO-LOAD-XX*200*20260701~',
  'REF*DP*038~',
  'PO1*1*100*EA*1.99**BP*ABC123*VN*K6-001~',
  'CTT*1*100~',
  'SE*6*0001~',
  'GE*1*1~',
  'IEA*1*ISACTL_XX~',
].join('\n');

// k6 doesn't support TextEncoder; use a tiny ASCII byte builder for the
// multipart payload below.
function asciiBytes(str) {
  const a = new Uint8Array(str.length);
  for (let i = 0; i < str.length; i += 1) a[i] = str.charCodeAt(i);
  return a;
}

function buildEnvelope(controlNumber) {
  // ISA control numbers are 9 digits — pad and zero-fill.
  const c = String(controlNumber).padStart(9, '0');
  return ENVELOPE_TEMPLATE.split('ISACTL_XX').join(c);
}

const headers = {
  Authorization: `Bearer ${BEARER}`,
  // No `Content-Type` here — k6's http.file builder sets the multipart
  // boundary correctly when we use the form helper below.
};

let nextControl = Math.floor(Math.random() * 1_000_000);

export default function () {
  // Per-iteration unique control number — keep it within 9-digit range.
  nextControl = (nextControl + 1) % 1_000_000_000;
  const body = buildEnvelope(nextControl);

  const formData = {
    file: http.file(asciiBytes(body), `load-${nextControl}.edi`, 'application/edi-x12'),
  };

  const res = http.post(`${BASE_URL}/api/ingest/upload`, formData, {
    headers,
    tags: { kind: 'ingest' },
  });
  ingestDuration.add(res.timings.duration);

  check(res, {
    'status 201 or 200': (r) => r.status === 201 || r.status === 200,
  });
}

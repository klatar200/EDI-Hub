/**
 * Typed client over the EDI Hub API. Consumes the shared response types from
 * @edi/shared (+ the parser's InterpretedTransaction), so the UI and API
 * contract never drift. Base path is proxied to the Fastify backend by Vite in
 * dev (see vite.config.ts).
 */
import type {
  AlertAckInput,
  AlertListResponse,
  AlertRecord,
  IngestListResponse,
  IngestUploadResponse,
  LifecycleResponse,
  OutboundStage,
  PartnerConfigInput,
  PartnerConfigListResponse,
  PartnersResponse,
  RejectionRateResponse,
  SearchResponse,
  SetupPatchInput,
  SetupStatusResponse,
  TradingPartnerRecord,
  TransactionListResponse,
  TransactionSummary,
} from '@edi/shared';
import type { InterpretedTransaction } from '@edi/edi-parser';
import type { TransactionRejection } from '@edi/shared';

// Desktop track D4 Sprint 2 — base URL is same-origin in every deployment:
//   - SaaS:    CloudFront serves the React build, /api/* is reverse-proxied to the API.
//   - Desktop: the Electron-managed Fastify process serves both /api/* and the React build
//              at http://127.0.0.1:3000 (LAN clients reach it at http://<server-ip>:3000).
//   - Dev:     Vite at :5173 proxies /api to the API at :3000 (see vite.config.ts).
// `VITE_API_URL` lets a developer override for an unusual local layout.
const BASE: string =
  (import.meta.env.VITE_API_URL as string | undefined) ?? '/api';

/** Phase 9 Sprint 2 — JWT plumbing.
 *
 *  api.ts is a plain module — no React context — so it needs a way to read
 *  the current Clerk JWT without importing React. main.tsx (via a small
 *  Clerk-aware bridge) calls `setAuthTokenGetter(...)` once at startup with
 *  a function that resolves the current token. Every fetch awaits it and
 *  attaches `Authorization: Bearer <jwt>`.
 *
 *  The getter is async because Clerk's `getToken()` rotates tokens
 *  transparently — it caches when fresh and re-fetches when stale.
 *
 *  Returning `null` is fine: in dev-fallback mode (no Clerk configured), the
 *  API accepts unauthenticated requests by pinning them to the pilot tenant. */
type AuthTokenGetter = () => Promise<string | null>;
let getAuthToken: AuthTokenGetter = async () => null;

export function setAuthTokenGetter(fn: AuthTokenGetter): void {
  getAuthToken = fn;
}

async function authHeaders(): Promise<Record<string, string>> {
  const token = await getAuthToken();
  return token ? { Authorization: `Bearer ${token}` } : {};
}

function qs(params: Record<string, string | number | undefined>): string {
  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== '') sp.set(k, String(v));
  }
  const s = sp.toString();
  return s ? `?${s}` : '';
}

async function get<T>(path: string): Promise<T> {
  const res = await fetch(`${BASE}${path}`, { headers: await authHeaders() });
  if (!res.ok) throw new Error(`API request failed (${res.status}) for ${path}`);
  return (await res.json()) as T;
}

/** Like `get`, but maps an explicit 404 to `null` instead of throwing. Used
 *  for endpoints (e.g. /lifecycle) where "no match" is a normal UI state. */
async function getOrNull<T>(path: string): Promise<T | null> {
  const res = await fetch(`${BASE}${path}`, { headers: await authHeaders() });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`API request failed (${res.status}) for ${path}`);
  return (await res.json()) as T;
}

/** Helper for POST/PATCH JSON bodies. Throws an Error carrying the parsed
 *  response so callers can inspect structured errors (e.g. ISA_OVERLAP). */
export class ApiCallError extends Error {
  constructor(message: string, public readonly status: number, public readonly body: unknown) {
    super(message);
    this.name = 'ApiCallError';
  }
}

async function send<T>(method: 'POST' | 'PATCH', path: string, body: unknown): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', ...(await authHeaders()) },
    body: JSON.stringify(body),
  });
  const json: unknown = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new ApiCallError(
      `API ${method} failed (${res.status}) for ${path}`,
      res.status,
      json,
    );
  }
  return json as T;
}

async function sendVoid(method: 'DELETE', path: string): Promise<void> {
  const res = await fetch(`${BASE}${path}`, { method, headers: await authHeaders() });
  if (!res.ok && res.status !== 204) {
    throw new Error(`API ${method} failed (${res.status}) for ${path}`);
  }
}

export interface DetailElement {
  index: number;
  value: string;
  semanticLabel: string | null;
}
export interface DetailSegment {
  tag: string;
  position: number;
  elements: DetailElement[];
}
export interface TransactionDetail extends TransactionSummary {
  rawFileId: string | null;
  errorMessage: string | null;
  declaredSegmentCount: number | null;
  segmentCount: number;
  delimiters: { element: string; subElement: string; segment: string } | null;
  interpreted: InterpretedTransaction;
  segments: DetailSegment[];
  /** Phase 5 — populated when a 997 has rejected this transaction; null otherwise. */
  rejection: TransactionRejection | null;
  /** Phase 8 Sprint 1 — direction relative to our ISA IDs. Drives whether the
   *  outbound stage timeline renders. */
  direction: 'inbound' | 'outbound' | 'unknown';
  /** Phase 8 Sprint 1 — outbound lifecycle timestamps (ISO-8601). All three
   *  null for inbound/unknown rows and for pre-Phase-8 rows that haven't been
   *  backfilled. */
  generatedAt: string | null;
  transmittedAt: string | null;
  confirmedAt: string | null;
  /** Phase 8 Sprint 1 — derived stage, server-side. Null when no timestamps
   *  are set. The web reads this directly rather than re-deriving so the
   *  rendered stage matches the API. */
  outboundStage: OutboundStage | null;
}

export interface TransactionFilters {
  set?: string;
  partner?: string;
  status?: string;
  po?: string;
  invoice?: string;
  direction?: string;
  from?: string;
  to?: string;
  limit?: number;
  offset?: number;
}

/** Which key resolved the lifecycle request. */
export type LifecycleKey = 'po' | 'invoice' | 'shipment';

export const api = {
  transactions: (f: TransactionFilters = {}) =>
    get<TransactionListResponse>(`/transactions${qs(f as Record<string, string | number | undefined>)}`),
  transaction: (id: string) => get<TransactionDetail>(`/transactions/${id}`),
  partners: () => get<PartnersResponse>('/partners'),
  ingest: (f: { status?: string; source?: string; from?: string; to?: string; limit?: number; offset?: number } = {}) =>
    get<IngestListResponse>(`/ingest${qs(f as Record<string, string | number | undefined>)}`),
  uploadIngest: async (file: File): Promise<IngestUploadResponse> => {
    const fd = new FormData();
    fd.append('file', file);
    const res = await fetch(`${BASE}/ingest/upload`, {
      method: 'POST',
      headers: await authHeaders(),
      body: fd,
    });
    const json: unknown = await res.json().catch(() => ({}));
    if (!res.ok) {
      const msg =
        typeof json === 'object' && json !== null && 'error' in json
          ? String((json as { error?: { message?: string } }).error?.message ?? `Upload failed (${res.status})`)
          : `Upload failed (${res.status})`;
      throw new ApiCallError(msg, res.status, json);
    }
    return json as IngestUploadResponse;
  },
  search: (q: string) => get<SearchResponse>(`/search${qs({ q })}`),
  /** GET /lifecycle?po=|invoice=|shipment= — returns null on 404 (no PO matched). */
  lifecycle: (key: LifecycleKey, value: string) =>
    getOrNull<LifecycleResponse>(`/lifecycle${qs({ [key]: value })}`),
  /** GET /metrics/rejection-rate — defaults to a rolling 30-day window. */
  rejectionRate: (params: { from?: string; to?: string; partner?: string } = {}) =>
    get<RejectionRateResponse>(`/metrics/rejection-rate${qs(params)}`),
  alerts: {
    list: (params: { status?: string; type?: string; partnerId?: string } = {}) =>
      get<AlertListResponse>(`/alerts${qs(params)}`),
    get: (id: string) => get<AlertRecord>(`/alerts/${id}`),
    ack: (id: string, input: AlertAckInput & { suppressMinutes?: number }) =>
      send<AlertRecord>('PATCH', `/alerts/${id}/ack`, input),
    snooze: (id: string, minutes: number) =>
      send<AlertRecord>('POST', `/alerts/${id}/snooze`, { minutes }),
  },
  /** Phase 9 Sprint 3 — RBAC plumbing. */
  me: () => get<UserRecord>('/me'),
  users: {
    list: () => get<{ items: UserRecord[] }>('/users'),
    update: (id: string, input: { role?: UserRole; displayName?: string | null }) =>
      send<UserRecord>('PATCH', `/users/${id}`, input),
    remove: (id: string) => sendVoid('DELETE', `/users/${id}`),
  },
  partnersConfig: {
    list: () => get<PartnerConfigListResponse>('/partners-config'),
    create: (input: PartnerConfigInput) => send<TradingPartnerRecord>('POST', '/partners-config', input),
    update: (id: string, input: PartnerConfigInput) =>
      send<TradingPartnerRecord>('PATCH', `/partners-config/${id}`, input),
    remove: (id: string) => sendVoid('DELETE', `/partners-config/${id}`),
  },
  /** Desktop track D8 Sprint 2 — first-run wizard state. */
  setup: {
    get: () => get<SetupStatusResponse>('/setup'),
    patch: (input: SetupPatchInput) => send<SetupStatusResponse>('PATCH', '/setup', input),
    verifyAuth: () => send<{ ok: boolean }>('POST', '/setup/verify-auth', {}),
  },
  rawFileContentUrl: (id: string) => `${BASE}/raw-files/${id}/content`,
  rawContent: async (id: string): Promise<string> => {
    const res = await fetch(`${BASE}/raw-files/${id}/content`, { headers: await authHeaders() });
    if (!res.ok) throw new Error(`Could not load raw file (${res.status})`);
    return res.text();
  },
};

export type { TransactionSummary };


/** Phase 9 Sprint 3 — RBAC. */
export type UserRole = 'admin' | 'ops' | 'viewer';
export interface UserRecord {
  id: string;
  email: string;
  displayName: string | null;
  role: UserRole;
  clerkUserId: string;
  createdAt: string;
  updatedAt: string;
}

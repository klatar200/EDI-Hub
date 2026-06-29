/**
 * Typed client over the EDI Hub API. Consumes the shared response types from
 * @edi/shared (+ the parser's InterpretedTransaction), so the UI and API
 * contract never drift. Base path is proxied to the Fastify backend by Vite in
 * dev (see vite.config.ts).
 */
import type {
  AlertAckInput,
  AlertBulkAckInput,
  AlertListResponse,
  AlertRecord,
  AuditListResponse,
  ChannelsResponse,
  IngestListResponse,
  IngestUploadResponse,
  LifecycleBulkExportInput,
  LifecycleListFilters,
  LifecycleListResponse,
  LifecycleNoteInput,
  LifecycleNoteListResponse,
  LifecycleNoteRecord,
  LifecycleResponse,
  OutboundStage,
  PartnerConfigInput,
  PartnerConfigListResponse,
  PartnersResponse,
  RejectionRateResponse,
  DashboardResponse,
  DashboardIngestWindow,
  SearchResponse,
  SetupPatchInput,
  SetupStatusResponse,
  TenantSettingsPatch,
  TenantSettingsResponse,
  TradingPartnerRecord,
  TransactionListResponse,
  TransactionSummary,
  UserPreferences,
  UserPreferencesResponse,
} from '@edi/shared';
import type { InterpretedTransaction } from '@edi/edi-parser';
import type { TransactionRejection } from '@edi/shared';

// Desktop track D4 Sprint 2 — base URL is same-origin in every deployment:
//   - SaaS:    CloudFront serves the React build, /api/* is reverse-proxied to the API.
//   - Desktop: the Electron-managed Fastify process serves both /api/* and the React build
//              at http://127.0.0.1:3000 (LAN clients reach it at http://<server-ip>:3000).
//   - Dev:     Vite at :5173 proxies /api to the API at :3000 (see vite.config.ts).
// `VITE_API_URL` lets a developer override for an unusual local layout.
// SEC-W2 — production builds only trust same-origin `/api`.
function resolveApiBase(): string {
  const override = import.meta.env.VITE_API_URL as string | undefined;
  if (!override || override === '/api') return '/api';
  if (import.meta.env.PROD) {
    console.warn('[SEC-W2] VITE_API_URL rejected in production — using /api');
    return '/api';
  }
  return override;
}

const BASE: string = resolveApiBase();

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

/** SEC-L1 — optional handler invoked on 401 responses (AuthBridge wires sign-out). */
type UnauthorizedHandler = () => void;
let onUnauthorized: UnauthorizedHandler | null = null;

export function setUnauthorizedHandler(fn: UnauthorizedHandler | null): void {
  onUnauthorized = fn;
}

function notifyUnauthorized(status: number): void {
  if (status === 401 && onUnauthorized) onUnauthorized();
}

async function authHeaders(): Promise<Record<string, string>> {
  const token = await getAuthToken();
  return token ? { Authorization: `Bearer ${token}` } : {};
}

/** Strip path separators and control chars from user-supplied download names. */
function safeDownloadFilename(name: string, fallback: string): string {
  const base = name.replace(/[/\\?%*:|"<>]/g, '_').replace(/\.\./g, '_').slice(0, 200);
  return base.length > 0 ? base : fallback;
}

function qs(params: Record<string, string | number | boolean | string[] | undefined>): string {
  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined || v === '') continue;
    if (Array.isArray(v)) {
      if (v.length > 0) sp.set(k, v.join(','));
    } else {
      sp.set(k, String(v));
    }
  }
  const s = sp.toString();
  return s ? `?${s}` : '';
}

async function get<T>(path: string): Promise<T> {
  const res = await fetch(`${BASE}${path}`, { headers: await authHeaders() });
  const json: unknown = await res.json().catch(() => ({}));
  if (res.status === 401) notifyUnauthorized(401);
  if (!res.ok) {
    throw new ApiCallError(
      `API request failed (${res.status}) for ${path}`,
      res.status,
      json,
    );
  }
  return json as T;
}

/** Like `get`, but maps an explicit 404 to `null` instead of throwing. Used
 *  for endpoints (e.g. /lifecycle) where "no match" is a normal UI state. */
async function getOrNull<T>(path: string): Promise<T | null> {
  const res = await fetch(`${BASE}${path}`, { headers: await authHeaders() });
  if (res.status === 404) return null;
  if (res.status === 401) notifyUnauthorized(401);
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

  errorCode(): string | undefined {
    const body = this.body as { error?: { code?: string } } | undefined;
    return body?.error?.code;
  }

  errorMessage(): string | undefined {
    const body = this.body as { error?: { message?: string } } | undefined;
    return body?.error?.message;
  }
}

async function send<T>(method: 'POST' | 'PATCH', path: string, body: unknown): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', ...(await authHeaders()) },
    body: JSON.stringify(body),
  });
  const json: unknown = await res.json().catch(() => ({}));
  if (res.status === 401) notifyUnauthorized(401);
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
  if (res.status === 401) notifyUnauthorized(401);
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
    if (res.status === 401) notifyUnauthorized(401);
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
  /** PS-1 — paginated PO/conversation list for the lifecycle-first homepage. */
  lifecycles: (f: LifecycleListFilters = {}) =>
    get<LifecycleListResponse>(`/lifecycles${qs(f as Record<string, string | number | boolean | undefined>)}`),
  /** GET /metrics/rejection-rate — defaults to a rolling 30-day window. */
  rejectionRate: (params: { from?: string; to?: string; partner?: string } = {}) =>
    get<RejectionRateResponse>(`/metrics/rejection-rate${qs(params)}`),
  /** PS-3 — ops dashboard aggregates. */
  dashboard: (params: { ingestWindow?: DashboardIngestWindow; rejectionWindowDays?: 7 | 30 } = {}) =>
    get<DashboardResponse>(`/dashboard${qs(params as Record<string, string | number | undefined>)}`),
  alerts: {
    list: (params: { status?: string; type?: string; partnerId?: string; partnerName?: string } = {}) =>
      get<AlertListResponse>(`/alerts${qs(params)}`),
    get: (id: string) => get<AlertRecord>(`/alerts/${id}`),
    ack: (id: string, input: AlertAckInput & { suppressMinutes?: number }) =>
      send<AlertRecord>('PATCH', `/alerts/${id}/ack`, input),
    bulkAck: (input: AlertBulkAckInput) =>
      send<{ acknowledged: number }>('POST', '/alerts/bulk-ack', input),
    snooze: (id: string, minutes: number) =>
      send<AlertRecord>('POST', `/alerts/${id}/snooze`, { minutes }),
  },
  /** PS-4 — trigger detection pass for current tenant. */
  runDetection: () => send<{ ok: boolean }>('POST', '/ops/detect', {}),
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
  rawContent: async (id: string): Promise<string> => {
    const res = await fetch(`${BASE}/raw-files/${id}/content`, { headers: await authHeaders() });
    if (res.status === 401) notifyUnauthorized(401);
    if (!res.ok) throw new Error(`Could not load raw file (${res.status})`);
    return res.text();
  },
  /** PS-2 — authenticated raw file download trigger. */
  downloadRawFile: async (id: string, filename?: string): Promise<void> => {
    const res = await fetch(`${BASE}/raw-files/${id}/content`, { headers: await authHeaders() });
    if (res.status === 401) notifyUnauthorized(401);
    if (!res.ok) throw new Error(`Could not download raw file (${res.status})`);
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = safeDownloadFilename(filename ?? '', `${id}.edi`);
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  },
  /** PS-5 — re-run parse pipeline for a raw file. */
  reparseRaw: (id: string) =>
    send<{ rawFile: import('@edi/shared').RawFileRecord; parse: unknown }>('POST', `/raw-files/${id}/reparse`, {}),
  /** PS-6 — tenant settings hub. */
  settings: {
    get: () => get<TenantSettingsResponse>('/settings'),
    patch: (input: TenantSettingsPatch) => send<TenantSettingsResponse>('PATCH', '/settings', input),
  },
  /** PS-7 — channel health. */
  channels: {
    list: () => get<ChannelsResponse>('/channels'),
  },
  /** PS-9 — lifecycle ops notes. */
  lifecycleNotes: {
    list: (po: string) => get<LifecycleNoteListResponse>(`/lifecycles/${encodeURIComponent(po)}/notes`),
    create: (po: string, input: LifecycleNoteInput) =>
      send<LifecycleNoteRecord>('POST', `/lifecycles/${encodeURIComponent(po)}/notes`, input),
    remove: async (po: string, id: string): Promise<void> => {
      await sendVoid('DELETE', `/lifecycles/${encodeURIComponent(po)}/notes/${id}`);
    },
  },
  /** PS-9 — export lifecycle conversation as txt/csv/pdf. */
  exportLifecycle: async (po: string, format: 'txt' | 'csv' | 'pdf'): Promise<void> => {
    const res = await fetch(
      `${BASE}/lifecycles/${encodeURIComponent(po)}/export?format=${format}`,
      { headers: await authHeaders() },
    );
    if (res.status === 401) notifyUnauthorized(401);
    if (!res.ok) throw new Error(`Export failed (${res.status})`);
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = safeDownloadFilename(`lifecycle-${po}.${format}`, `lifecycle-export.${format}`);
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  },
  /** PS-9 — export raw file as txt/csv/pdf. */
  exportRaw: async (id: string, format: 'txt' | 'csv' | 'pdf'): Promise<void> => {
    const res = await fetch(`${BASE}/raw-files/${id}/export?format=${format}`, { headers: await authHeaders() });
    if (res.status === 401) notifyUnauthorized(401);
    if (!res.ok) throw new Error(`Export failed (${res.status})`);
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = safeDownloadFilename(`${id}.${format}`, `export.${format}`);
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  },
  /** PS-10 — user preferences (saved views, pins). */
  preferences: {
    get: () => get<UserPreferencesResponse>('/preferences'),
    patch: (preferences: UserPreferences) => send<UserPreferencesResponse>('PATCH', '/preferences', preferences),
  },
  /** PS-11 — audit log (admin). */
  audit: {
    list: (params: { actorId?: string; action?: string; from?: string; to?: string; limit?: number; offset?: number } = {}) =>
      get<AuditListResponse>(`/audit${qs(params as Record<string, string | number | undefined>)}`),
  },
  /** PS-11 — bulk lifecycle CSV or ZIP export. */
  exportLifecyclesCsv: async (input: LifecycleBulkExportInput): Promise<void> => {
    const res = await fetch(`${BASE}/lifecycles/export`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(await authHeaders()) },
      body: JSON.stringify(input),
    });
    if (res.status === 401) notifyUnauthorized(401);
    if (!res.ok) throw new Error(`Export failed (${res.status})`);
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = input.format === 'zip' ? 'lifecycles-export.zip' : 'lifecycles-export.csv';
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  },
  exportLifecyclesZip: (pos: string[], opts?: { includeRaw?: boolean }) =>
    api.exportLifecyclesCsv({
      pos,
      format: 'zip',
      includeFormats: ['txt', 'csv', 'pdf'],
      includeRaw: opts?.includeRaw,
    }),
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

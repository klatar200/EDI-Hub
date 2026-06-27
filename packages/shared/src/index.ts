/**
 * Shared types for the EDI Data Hub.
 *
 * This package is the single source of truth for cross-cutting domain types
 * (ingestion sources, statuses, API response shapes). It has no runtime
 * dependencies so it can be imported by both the API and the parser.
 */

/** How a raw file physically arrived at the hub. Passive copies only.
 *  Phase 8 Sprint 2 added 'as2' — the OpenAS2 daemon decrypts the AS2
 *  payload server-side and drops the plaintext EDI into a watched folder.
 *  We never sit in the live AS2 transmission path. */
export const SOURCE_CHANNELS = ['upload', 'sftp', 'as2'] as const;
export type SourceChannel = (typeof SOURCE_CHANNELS)[number];

/**
 * Lifecycle status of an ingested raw file.
 *
 * Mirrors the Prisma `RawFileStatus` enum. Sprint 2 uses RECEIVED and
 * DUPLICATE (as a response signal); the remaining statuses are filled in by
 * later sprints (parsing, failure-mode coverage).
 */
export const RAW_FILE_STATUSES = [
  'RECEIVED',
  'DUPLICATE',
  'PARSED',
  'PARSE_ERROR',
  'UNRECOGNIZED_FORMAT',
  'FAILED',
  // Phase 10 Sprint 3 — retention worker flips raw files past TTL to
  // ARCHIVED instead of deleting the row, so transaction lineage survives.
  'ARCHIVED',
] as const;
export type RawFileStatus = (typeof RAW_FILE_STATUSES)[number];

/** Successful (or duplicate) upload response. */
export interface IngestDuplicateOf {
  id: string;
  ingestedAt: string;
  source: SourceChannel;
  status: RawFileStatus;
}

/** Successful (or duplicate) upload response. */
export interface IngestUploadResponse {
  id: string;
  s3Key: string;
  status: RawFileStatus;
  fileHash: string;
  isaControlNumber: string | null;
  /** True when this interchange was already ingested; no new S3 write happened. */
  duplicate: boolean;
  /** PB-2 F53 — original file when duplicate is true. */
  duplicateOf?: IngestDuplicateOf;
}

/** Structured error response returned by the API. */
export interface ApiErrorResponse {
  error: {
    code: string;
    message: string;
  };
}

/** Public-facing representation of a raw_files record. */
export interface RawFileRecord {
  id: string;
  s3Key: string;
  fileHash: string;
  isaControlNumber: string | null;
  source: SourceChannel;
  status: RawFileStatus;
  errorMessage: string | null;
  ingestedAt: string; // ISO-8601
}

/** Paginated list of ingestion records. */
export interface IngestListResponse {
  items: RawFileRecord[];
  limit: number;
  offset: number;
  count: number;
}

// ─────────────────────────────────────────────────────────────
// Phase 3 — Data Hub UI read models
// ─────────────────────────────────────────────────────────────

/** A transaction row as shown in the list (joined with partner + status). */
export interface TransactionSummary {
  id: string;
  transactionSetId: string;
  controlNumber: string;
  poNumber: string | null;
  invoiceNumber: string | null;
  purpose: string | null;
  senderId: string | null;
  receiverId: string | null;
  status: RawFileStatus | null;
  ingestedAt: string | null; // ISO-8601
  /** Inbound/outbound relative to tenant OUR_ISA_IDS at parse time. */
  direction: LifecycleDirection;
}

export interface TransactionListResponse {
  items: TransactionSummary[];
  limit: number;
  offset: number;
  count: number;
}

/** Distinct trading partners seen across ingested interchanges. */
export interface PartnersResponse {
  partners: string[];
}

/** Result of a global search by PO / invoice / ISA control number. */
/** PS-10 — lifecycle hit in search results. */
export interface LifecycleSearchHit {
  po: string;
  partnerDisplayName: string | null;
  lastActivityAt: string;
  openAlertCount: number;
}

/** Result of a global search by PO / invoice / ISA control number. */
export interface SearchResponse {
  query: string;
  /** PS-10 — lifecycle (PO) hits first. */
  lifecycles: LifecycleSearchHit[];
  transactions: TransactionSummary[];
  rawFiles: RawFileRecord[];
}

// ─────────────────────────────────────────────────────────────
// Phase 4 — Transaction Lifecycle Stitching (the North Star)
// ─────────────────────────────────────────────────────────────

/** Direction of a transaction relative to the hub operator. Mirrors the
 *  Prisma `Direction` enum but lives in shared so the web app can consume it
 *  without importing the Prisma client. */
export const LIFECYCLE_DIRECTIONS = ['inbound', 'outbound', 'unknown'] as const;
export type LifecycleDirection = (typeof LIFECYCLE_DIRECTIONS)[number];

/**
 * Status of a single lifecycle event.
 *  - `received`         : document is present; no ack expected (or none yet).
 *  - `acknowledged`     : a 997 with AK5=A (or group AK9=A) was received for it.
 *  - `rejected`         : a 997 with AK5=R (or group AK9=R) was received for it.
 *  - `expected_missing` : the seed flow expects this document but none was found.
 */
export const LIFECYCLE_STATUSES = [
  'received',
  'acknowledged',
  'rejected',
  'expected_missing',
] as const;
export type LifecycleStatus = (typeof LIFECYCLE_STATUSES)[number];

/** Which seed flow the lifecycle matched. Used by the UI to label the chain
 *  and by Phase 6 to externalize the rules. */
export type LifecycleFlow = 'standard' | 'grocery' | 'unknown';

/** Phase 8 Sprint 1 — outbound transaction stage. Derived from the three
 *  timestamps on `transactions` (generatedAt, transmittedAt, confirmedAt);
 *  the stage is the furthest-populated one. Null on inbound and gap events
 *  (no outbound state to surface). */
export type OutboundStage = 'generated' | 'transmitted' | 'confirmed';

/** Phase 8 Sprint 1 — derive the outbound stage from the three timestamps.
 *  Furthest-populated column wins. All three null → null (treat as no signal).
 *  Lives in @edi/shared so the API and web agree on the derivation. */
export function deriveOutboundStage(
  generatedAt: Date | string | null | undefined,
  transmittedAt: Date | string | null | undefined,
  confirmedAt: Date | string | null | undefined,
): OutboundStage | null {
  if (confirmedAt) return 'confirmed';
  if (transmittedAt) return 'transmitted';
  if (generatedAt) return 'generated';
  return null;
}

/** A single position on the lifecycle timeline — either an ingested document
 *  (`kind: 'transaction'`) or an expected-but-absent slot (`kind: 'gap'`). */
export interface LifecycleEvent {
  kind: 'transaction' | 'gap';
  /** '850' / '855' / '856' / '860' / '875' / '880' / '810' / '997'. */
  transactionSetId: string;
  /** Real direction for a transaction; the direction it would have for a gap. */
  direction: LifecycleDirection;
  status: LifecycleStatus;
  /** Null on gaps. */
  transactionId: string | null;
  rawFileId: string | null;
  controlNumber: string | null;
  /** ISO-8601. Null on gaps. */
  ingestedAt: string | null;
  /** For 997 events only — the AK9 group acknowledgment status (A/E/R). */
  ackStatus: string | null;
  /** Transaction id of the 997 that acknowledged this event, if any. */
  ackedByTransactionId: string | null;
  /** Phase 5 — a one-line plain-English summary of why this event was
   *  rejected (e.g. "BEG03 — Mandatory data element missing"). Null when the
   *  event was accepted or there is no detail. Populated on both 997 events
   *  (their own AK3/AK4) and rejected originals (a copy from the matching 997). */
  rejectionSummary: string | null;
  /** Phase 5 — the full structured AK3/AK4 tree decoded against the X12
   *  dictionary. Null when there are no errors. */
  rejectionDetails: RejectionSegmentError[] | null;
  /** Phase 8 Sprint 1 — derived stage for outbound transactions
   *  ('generated' | 'transmitted' | 'confirmed'). Null when:
   *    - direction is inbound or unknown (no outbound state),
   *    - the event is a gap (no transaction exists yet),
   *    - the originating transaction predates Phase 8 and hasn't been backfilled.
   *  See `OutboundStage` for derivation rules. */
  outboundStage: OutboundStage | null;
  /** Phase 8 Sprint 3 — the partner's configured transmission channel, when
   *  the partner record has connectivity configured. Surfaced on outbound
   *  rows so ops can see at a glance how a transaction was transmitted.
   *  Null when no partner is configured, or the partner has no connectivity. */
  partnerChannel: ConnectivityChannel | null;
  /** ISA13 control number from the interchange envelope. Null on gaps. */
  isaControlNumber: string | null;
  /** How the underlying raw file arrived. Null on gaps. */
  source: SourceChannel | null;
  /** 1-based index among events sharing the same (transactionSetId, direction).
   *  Null on gaps and when only one document of that type exists. */
  instanceIndex: number | null;
  /** PB-5 F7 — one-line typed header for 855/856 (ship date, qty, carrier, ack type). */
  headerSummary: string | null;
}

/** The PO-spine lifecycle response. */
export interface LifecycleResponse {
  /** The PO number every event in this chain shares. */
  po: string;
  /** How the request was resolved to the PO spine. */
  enteredBy: { kind: 'po' | 'invoice' | 'shipment'; value: string };
  /** Which seed flow the timeline matched. */
  flow: LifecycleFlow;
  /** Chronologically ordered events, with gaps inserted at their expected slot. */
  events: LifecycleEvent[];
  /** Resolved trading partner for this conversation, when identifiable. */
  partner: {
    id: string;
    displayName: string;
    slaCountdownEnabled: boolean;
    slaWindows: PartnerSlaWindow[];
  } | null;
}

/** PS-1 — paginated lifecycle list row (conversation summary). */
export interface LifecycleSummary {
  po: string;
  partnerId: string | null;
  partnerDisplayName: string | null;
  flow: LifecycleFlow;
  startedAt: string;
  lastActivityAt: string;
  received: number;
  missing: number;
  rejected: number;
  openAlertCount: number;
  hasParseError: boolean;
  hasDuplicates: boolean;
  additionalDocumentCount: number;
  /** PS-2 — proactive expected-document warnings (gap rows in the flow). */
  expectedWarnings: string[];
  /** PB-4 F33 — worst-case SLA countdown for this row; null when disabled or no open SLA. */
  slaSummary: { label: string; breached: boolean } | null;
}

export interface LifecycleListResponse {
  items: LifecycleSummary[];
  page: number;
  pageSize: number;
  total: number;
}

export interface LifecycleListFilters {
  page?: number;
  pageSize?: number;
  partnerId?: string;
  from?: string;
  to?: string;
  hasAlerts?: boolean;
  hasParseError?: boolean;
  flow?: LifecycleFlow;
  /** PS-2 — filter to POs containing this set (optionally with direction). */
  setId?: string;
  setDirection?: LifecycleDirection;
  /** PS-10 F43 — restrict list to these PO numbers (comma-separated in query). */
  pos?: string[];
  /** PB-5 F44 — sort by first-document timestamp (default startedAt:desc). */
  sort?: 'startedAt:asc' | 'startedAt:desc';
}

// ─────────────────────────────────────────────────────────────
// Phase 5 — Acknowledgment intelligence (rejection detail + per-partner rate)
// ─────────────────────────────────────────────────────────────

/** Phase 5 — one element-level error from an AK4 segment, mirror of the
 *  edi-parser shape, redeclared here so the web app can consume it without
 *  importing the parser at runtime. */
export interface RejectionElementError {
  /** AK401 — element position within the offending segment (e.g. "3" for BEG03). */
  elementPosition: string;
  /** AK402 — X12 data-element reference number (e.g. "324"). */
  dataElementReference: string;
  /** AK403 — element-level syntax error code (e.g. "1" = mandatory missing). */
  syntaxErrorCode: string;
  /** Decoded message from the X12 dictionary, or null if the code is unknown. */
  syntaxErrorMessage: string | null;
  /** AK404 — copy of the bad value if the sender provided one. */
  badValue: string;
}

/** Phase 5 — one segment-level error from an AK3 segment. */
export interface RejectionSegmentError {
  segmentTag: string;
  segmentPosition: string;
  loopIdentifier: string;
  syntaxErrorCode: string;
  syntaxErrorMessage: string | null;
  elementErrors: RejectionElementError[];
}

/** Per-partner rolling-window rejection-rate row.
 *  Rejected count uses the strict definition: AK5 = R or M only (Gate C). */
export interface RejectionRateRow {
  /** The trading partner (the side that isn't the hub operator). */
  partner: string;
  /** Total acknowledged transactions for this partner in the window. */
  total: number;
  /** Rejected count (AK5 = R or M). */
  rejected: number;
  /** rejected / total, or 0 when total = 0. */
  rate: number;
}

export interface RejectionRateResponse {
  /** Window start (ISO-8601). */
  windowFrom: string;
  /** Window end (ISO-8601). */
  windowTo: string;
  rows: RejectionRateRow[];
}

// ─────────────────────────────────────────────────────────────
// PS-3 — Ops dashboard
// ─────────────────────────────────────────────────────────────

export type DashboardIngestWindow = '24h' | '7d' | '30d' | 'all';

export interface DashboardTrafficSilence {
  /** ISO timestamp of most recent ingest from any partner; null when none. */
  lastGlobalIngestAt: string | null;
  /** True when no ingest in the configured stale window (default 6h). */
  isGloballyStale: boolean;
  staleWindowHours: number;
  partners: Array<{
    partnerId: string;
    displayName: string;
    lastIngestAt: string | null;
  }>;
}

export interface DashboardOpenAlerts {
  total: number;
  bySeverity: { critical: number; warning: number; info: number };
  topPartners: Array<{ partnerId: string | null; displayName: string; count: number }>;
}

export interface DashboardIngestHealth {
  window: DashboardIngestWindow;
  parsed: number;
  parseError: number;
  failed: number;
  duplicate: number;
  received: number;
}

export interface DashboardRejectionTrend {
  partner: string;
  /** Daily rejection rates (oldest → newest), length = windowDays. */
  dailyRates: number[];
}

export interface DashboardPartnerHealthRow {
  partnerId: string;
  displayName: string;
  lastIngestAt: string | null;
  lastAckAt: string | null;
  rejectionRate30d: number;
  openAlertCount: number;
  /** PB-3 F3 — open MISSING_ACK alerts for this partner. */
  missingAckCount: number;
}

export interface DashboardRecentFailure {
  id: string;
  status: RawFileStatus;
  errorMessage: string | null;
  ingestedAt: string;
  isaControlNumber: string | null;
}

export interface DashboardResponse {
  trafficSilence: DashboardTrafficSilence;
  openAlerts: DashboardOpenAlerts;
  ingestHealth: DashboardIngestHealth;
  rejectionTrends: { windowDays: 7 | 30; trends: DashboardRejectionTrend[] };
  partnerHealth: DashboardPartnerHealthRow[];
  /** PB-3 F1 — recent parse/failed ingestions for triage. */
  recentFailures: DashboardRecentFailure[];
}

/** Phase 5 — rejection info attached to a non-997 transaction's detail
 *  response when it was rejected (AK5 R/M) by a 997. Null when there's no
 *  ack or the ack was accepted. */
export interface TransactionRejection {
  ackTransactionId: string;
  ackRawFileId: string;
  status: string;
  statusMessage: string | null;
  summary: string | null;
  details: RejectionSegmentError[];
}

// ─────────────────────────────────────────────────────────────
// Phase 6 — Trading Partner Configuration
// ─────────────────────────────────────────────────────────────

export const PARTNER_STATUSES = ['active', 'disabled'] as const;
export type PartnerStatus = (typeof PARTNER_STATUSES)[number];

// ─────────────────────────────────────────────────────────────
// Phase 8 Sprint 3 — partner connectivity metadata
// ─────────────────────────────────────────────────────────────

/** Channels we model on a partner record. Wider than what we *receive* over
 *  (SourceChannel) — VAN/API/EMAIL are operational metadata the hub never
 *  receives directly but ops still want documented on the partner. */
export const CONNECTIVITY_CHANNELS = ['AS2', 'SFTP', 'VAN', 'API', 'EMAIL'] as const;
export type ConnectivityChannel = (typeof CONNECTIVITY_CHANNELS)[number];

/** Phase 8 Sprint 3 — Gate C shape.
 *  Credentials are NEVER stored here — they live in env / secrets manager
 *  and may be referenced by name from `endpoint` or `notes`. */
export interface PartnerConnectivity {
  channel: ConnectivityChannel;
  /** The address ops would use to reach the partner — host, URL, mailbox id,
   *  partner-side directory, depending on `channel`. */
  endpoint: string;
  /** Email address ops contacts when transmissions misbehave. */
  technicalContact: string;
  /** Free-form ops notes. Empty / omitted when not needed. */
  notes?: string;
}

/** Whether a connectivity record is "configured" — has at least the three
 *  required fields. Used by the lifecycle UI to decide whether to surface
 *  the channel chip. */
export function isConnectivityConfigured(c: PartnerConnectivity | null | undefined): c is PartnerConnectivity {
  return !!c && !!c.channel && !!c.endpoint && !!c.technicalContact;
}

/** Escalation contact on a partner profile. Email is required; the optional
 *  Slack webhook + alert-type opt-ins are populated by the Phase 7 alerts
 *  pipeline so the notifier knows where to route what. */
export interface PartnerContact {
  name: string;
  email: string;
  role: string;
  /** Phase 7 — POST alerts to this Slack incoming-webhook URL. */
  slackWebhook?: string;
  /** Phase 7 — restrict alerts to these types; empty/omitted = all types. */
  alertTypeOptIns?: AlertType[];
}

export interface TradingPartnerRecord {
  id: string;
  /** Phase 9 Sprint 1 — required tenant scope. */
  tenantId: string;
  displayName: string;
  isaSenderIds: string[];
  isaReceiverIds: string[];
  status: PartnerStatus;
  notes: string | null;
  contacts: PartnerContact[];
  /** Phase 6 Sprint 2 — empty array means "accept any set" (backward compat). */
  supportedSets: string[];
  /** Phase 6 Sprint 2 — empty array means "use shipped defaults" (Phase 4 behavior). */
  lifecycleFlows: LifecycleFlowDefinition[];
  /** Phase 6 Sprint 2 — empty object means "use shipped X12 dictionary" (Phase 5 behavior). */
  ackCodeOverrides: AckCodeOverrides;
  /** PS-11 F19 — Z-segment / proprietary element label overrides. */
  segmentLabelOverrides: SegmentLabelOverrides;
  /** Phase 6 Sprint 3 — empty array means "no SLA" (Phase 7 skips this partner). */
  slaWindows: PartnerSlaWindow[];
  /** PB-4 F33 — show SLA countdown on lifecycle rows for this partner. */
  slaCountdownEnabled: boolean;
  /** Phase 8 Sprint 3 — connectivity metadata. `null` means "not yet
   *  configured" — the connectivity editor section will be empty and the
   *  lifecycle UI's channel chip will be hidden. */
  connectivity: PartnerConnectivity | null;
  createdAt: string; // ISO-8601
  updatedAt: string; // ISO-8601
}

export interface PartnerConfigListResponse {
  items: TradingPartnerRecord[];
}

/** Body accepted by POST /partners-config and PATCH /partners-config/:id. */
export interface PartnerConfigInput {
  displayName: string;
  isaSenderIds: string[];
  isaReceiverIds: string[];
  status?: PartnerStatus;
  notes?: string | null;
  contacts?: PartnerContact[];
  /** Sprint 2 — omit to keep current value on PATCH. */
  supportedSets?: string[];
  lifecycleFlows?: LifecycleFlowDefinition[];
  ackCodeOverrides?: AckCodeOverrides;
  segmentLabelOverrides?: SegmentLabelOverrides;
  /** Sprint 3 — per-(set, direction) SLA windows. */
  slaWindows?: PartnerSlaWindow[];
  /** PB-4 F33 — per-partner SLA countdown toggle. */
  slaCountdownEnabled?: boolean;
  /** Phase 8 Sprint 3 — partner connectivity. Omit on PATCH to leave the
   *  current value alone; pass `null` to explicitly clear it. */
  connectivity?: PartnerConnectivity | null;
}

// ─────────────────────────────────────────────────────────────
// Phase 6 Sprint 2 — Per-partner parser + lifecycle config
// ─────────────────────────────────────────────────────────────

/** One step in a partner-configured lifecycle flow.
 *  Mirror of the internal `ExpectedDoc` shape used by the lifecycle service. */
export interface LifecycleFlowStep {
  setId: string;
  direction: LifecycleDirection;
}

/** A partner-supplied lifecycle flow. The lifecycle service picks the flow
 *  whose `entrySetId` matches the spine's entry set; falls back to the
 *  shipped defaults when no partner flow matches. */
export interface LifecycleFlowDefinition {
  /** Display name, e.g. "Sysco standard" — shown on the lifecycle header. */
  name: string;
  /** The set that anchors the flow (e.g. "850" or "875"). */
  entrySetId: string;
  /** Ordered expected documents for the chain. */
  steps: LifecycleFlowStep[];
}

/** Per-partner ack-code overrides. Keys are X12 AK fields; values map each
 *  raw code to a replacement message. Codes not in the override map keep the
 *  shipped X12 wording. */
export interface AckCodeOverrides {
  AK304?: Record<string, string>;
  AK403?: Record<string, string>;
  AK501?: Record<string, string>;
  AK901?: Record<string, string>;
}

/** Shipped-default lifecycle flows. Mirrors the constants the lifecycle
 *  service has used since Phase 4. Exported here so the web app can preview
 *  partner overrides against the defaults, and the API can fall back without
 *  duplicating the data. */
export const DEFAULT_STANDARD_FLOW: LifecycleFlowDefinition = {
  name: 'Standard PO flow',
  entrySetId: '850',
  steps: [
    { setId: '850', direction: 'inbound' },
    { setId: '997', direction: 'outbound' },
    { setId: '855', direction: 'outbound' },
    { setId: '997', direction: 'inbound' },
    { setId: '810', direction: 'outbound' },
    { setId: '997', direction: 'inbound' },
  ],
};

export const DEFAULT_GROCERY_FLOW: LifecycleFlowDefinition = {
  name: 'Grocery PO flow',
  entrySetId: '875',
  steps: [
    { setId: '875', direction: 'inbound' },
    { setId: '880', direction: 'outbound' },
  ],
};

// ─────────────────────────────────────────────────────────────
// Phase 6 Sprint 3 — Per-partner SLA windows
// ─────────────────────────────────────────────────────────────

/** One SLA window on a partner. Phase 7's missing-ack detector consumes this
 *  shape directly: "if a `setId` in this direction hasn't received its
 *  `expectedAckSetId` within `withinMinutes`, alert." */
export interface PartnerSlaWindow {
  setId: string;
  direction: LifecycleDirection;
  /** Flat minutes. Calendar-aware (business hours / holidays) is a
   *  Future Features item — see BUILD_PLAN §12. */
  withinMinutes: number;
  /** Optional: the ack set we expect (default '997'). */
  expectedAckSetId?: string;
}

// ─────────────────────────────────────────────────────────────
// Phase 7 — Monitoring & Alerting
// ─────────────────────────────────────────────────────────────

export const ALERT_TYPES = [
  'MISSING_ACK',
  'REJECTION_RATE_SPIKE',
  'STALE_TRAFFIC',
] as const;
export type AlertType = (typeof ALERT_TYPES)[number];

export const ALERT_SEVERITIES = ['info', 'warning', 'critical'] as const;
export type AlertSeverity = (typeof ALERT_SEVERITIES)[number];

export const ALERT_STATUSES = ['active', 'acknowledged', 'resolved'] as const;
export type AlertStatus = (typeof ALERT_STATUSES)[number];

/** Read model for a single alert returned by `GET /alerts`. */
export interface AlertRecord {
  id: string;
  /** Null when the alert isn't scoped to a configured partner. */
  partnerId: string | null;
  type: AlertType;
  severity: AlertSeverity;
  title: string;
  body: string;
  /** Stable identifier used to dedupe reruns of the detector. */
  dedupeKey: string;
  /** Structured pointer back to the source data. Schema varies by type. */
  sourceRef: Record<string, unknown>;
  status: AlertStatus;
  createdAt: string;       // ISO-8601
  lastSeenAt: string;      // ISO-8601 — bumped on every detector run that re-emits this dedupe key
  acknowledgedAt: string | null;
  acknowledgedBy: string | null;
  suppressUntil: string | null;
}

export interface AlertListResponse {
  items: AlertRecord[];
}

export interface AlertFilters {
  status?: AlertStatus;
  type?: AlertType;
  partnerId?: string;
  /** PS-4 — case-insensitive substring match on partner display name. */
  partnerName?: string;
  from?: string;
  to?: string;
}

export interface AlertAckInput {
  who: string;
}

export interface AlertBulkAckInput {
  who: string;
  partnerId?: string;
  partnerName?: string;
}

export interface AlertBulkAckResponse {
  acknowledged: number;
}

/** Phase 7 Sprint 2 — runtime delivery mode for the alert notifier. */
export const NOTIFIER_MODES = ['disabled', 'preview', 'live'] as const;
export type NotifierMode = (typeof NOTIFIER_MODES)[number];

/** Phase 7 — preview-mode trail entry kept inside `alert.sourceRef.previewTrail`
 *  so the UI can show what *would* have been delivered. */
export interface PreviewTrailEntry {
  channel: 'email' | 'slack';
  /** Email address or webhook URL we would have hit. */
  recipient: string;
  /** ISO-8601 — when the preview row was written. */
  at: string;
}

/** Desktop track D8 Sprint 2 — persisted hub config in `<userData>/config.json`.
 *  Electron auto-update also stores `pendingWhatsNew` in the same file. */
export interface HubConfig {
  firstRunComplete?: boolean;
  dropFolderPath?: string;
  telemetryEnabled?: boolean;
  /** Wizard step 2 — admin confirmed Clerk redirect URIs for this server. */
  clerkRedirectVerified?: boolean;
  /** D7 — version awaiting a one-time "What's new" dialog after relaunch. */
  pendingWhatsNew?: string;
}

/** GET /api/setup — first-run wizard state for the signed-in tenant. */
export interface SetupStatusResponse {
  /** False on a fresh desktop install until the wizard completes. Always true in SaaS. */
  firstRunComplete: boolean;
  dropFolderPath: string | null;
  telemetryEnabled: boolean | null;
  /** True once at least one raw file exists for this tenant. */
  hasIngested: boolean;
  /** False until the admin confirms Clerk redirect URIs in the wizard. */
  clerkRedirectVerified: boolean;
  /** Desktop installs only — false in SaaS where setup is N/A. */
  desktopMode: boolean;
  /** ISA IDs that identify this tenant in interchange envelopes (ISA06/08). */
  ourIsaIds: string[];
}

/** PATCH /api/setup — partial hub config updates from the wizard. */
export interface SetupPatchInput {
  dropFolderPath?: string;
  telemetryEnabled?: boolean;
  clerkRedirectVerified?: boolean;
  firstRunComplete?: boolean;
  /** One or more ISA IDs for this tenant — used for inbound/outbound classification. */
  ourIsaIds?: string[];
}

/** Public server addressing surfaced on GET /health for Clerk redirect setup. */
export interface HealthServerInfo {
  port: number;
  /** Origins to add to Clerk Allowed redirect URIs (includes localhost + LAN IPs). */
  redirectOrigins: string[];
}

// ─────────────────────────────────────────────────────────────
// PS-6 — Tenant settings hub
// ─────────────────────────────────────────────────────────────

export interface TenantSettings {
  /** F2 — global stale-traffic detection window in hours (default 6). */
  staleTrafficWindowHours: number;
  /** F33 — show SLA countdown on lifecycle rows (default off). */
  slaCountdownEnabled: boolean;
  /** F13 — quiet hours for notifications (optional stub). */
  quietHoursStart: string | null;
  quietHoursEnd: string | null;
  /** F51 — daily email digest opt-in. */
  emailDigestEnabled: boolean;
  /** Hour (0–23 UTC) to send digest. */
  emailDigestHourUtc: number;
}

export interface TenantSettingsResponse {
  settings: TenantSettings;
  /** True when the caller can PATCH settings (admin). */
  canEdit: boolean;
}

export type TenantSettingsPatch = Partial<TenantSettings>;

// ─────────────────────────────────────────────────────────────
// PS-7 — Channel health page
// ─────────────────────────────────────────────────────────────

export type ChannelHealthStatus = 'running' | 'disabled' | 'error';

export interface ChannelHealthRecord {
  name: string;
  source: SourceChannel;
  status: ChannelHealthStatus;
  error?: string;
  detail?: Record<string, string>;
}

export interface ChannelsResponse {
  channels: ChannelHealthRecord[];
}

// ─────────────────────────────────────────────────────────────
// PS-9 — Lifecycle ops notes
// ─────────────────────────────────────────────────────────────

export interface LifecycleNoteRecord {
  id: string;
  po: string;
  body: string;
  authorId: string | null;
  authorDisplayName: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface LifecycleNoteListResponse {
  items: LifecycleNoteRecord[];
}

export interface LifecycleNoteInput {
  body: string;
}

// ─────────────────────────────────────────────────────────────
// PS-10 — Saved views + pins
// ─────────────────────────────────────────────────────────────

export interface SavedView {
  id: string;
  name: string;
  /** URL query string for / lifecycles (without leading ?). */
  query: string;
}

export interface UserPreferences {
  savedViews?: SavedView[];
  /** F43 — max 10 pinned PO numbers. */
  pinnedPos?: string[];
}

export interface UserPreferencesResponse {
  preferences: UserPreferences;
}

// ─────────────────────────────────────────────────────────────
// PS-11 — Audit log viewer + bulk export
// ─────────────────────────────────────────────────────────────

export interface AuditEventRecord {
  id: string;
  actorId: string | null;
  action: string;
  targetType: string;
  targetId: string;
  payloadDiff: unknown;
  createdAt: string;
}

export interface AuditListResponse {
  items: AuditEventRecord[];
  limit: number;
  offset: number;
  count: number;
}

/** PS-11 F57 — bulk lifecycle export request. */
export type LifecycleExportFormat = 'txt' | 'csv' | 'pdf';

export interface LifecycleBulkExportInput {
  pos: string[];
  /** csv = summary manifest (default); zip = folder per PO with txt/csv/pdf. */
  format?: 'csv' | 'zip';
  /** Included in zip exports; defaults to all three. */
  includeFormats?: LifecycleExportFormat[];
}

/** PS-11 F19 — Z-segment label overrides on partner config. */
export type SegmentLabelOverrides = Record<string, Record<string, string>>;

export {
  CLERK_DASHBOARD_URL,
  LAN_INSTALL_DOCS_URL,
  preferredLanOrigin,
  RELEASES_URL,
} from './help-links.js';

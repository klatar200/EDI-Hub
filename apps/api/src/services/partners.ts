/**
 * Phase 6 — Trading-partner identity resolution + CRUD service helpers.
 *
 * Per Gate C, existing transactions don't carry a FK to `trading_partners`.
 * The system resolves a partner from an interchange's ISA sender/receiver
 * pair at query time using the configured ISA arrays on each partner record.
 *
 * Per Gate E, the DB doesn't enforce ISA uniqueness across array elements
 * (Postgres can't express that cleanly without an extension). Uniqueness is
 * an application-layer guarantee — every create/update routes through
 * `assertNoIsaOverlap` before persisting, returning a 409 if the proposed
 * partner overlaps with another partner's IDs.
 */
import type { PrismaClient } from '@prisma/client';
import type {
  AckCodeOverrides,
  ConnectivityChannel,
  LifecycleFlowDefinition,
  LifecycleFlowStep,
  LifecycleDirection,
  PartnerConfigInput,
  PartnerConnectivity,
  PartnerContact,
  PartnerSlaWindow,
  PartnerStatus,
  TradingPartnerRecord,
} from '@edi/shared';
import { CONNECTIVITY_CHANNELS } from '@edi/shared';

interface DbPartnerRow {
  id: string;
  /** Phase 9 Sprint 1 — promoted from string|null to string (NOT NULL in DB). */
  tenantId: string;
  displayName: string;
  isaSenderIds: string[];
  isaReceiverIds: string[];
  status: PartnerStatus;
  notes: string | null;
  contacts: unknown;
  supportedSets: string[];
  lifecycleFlows: unknown;
  ackCodeOverrides: unknown;
  slaWindows: unknown;
  /** Phase 8 Sprint 3 — JSONB; '{}' default means "not yet configured". */
  connectivity: unknown;
  createdAt: Date;
  updatedAt: Date;
}

function readContacts(raw: unknown): PartnerContact[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((c): c is Record<string, unknown> => typeof c === 'object' && c !== null)
    .map((c) => {
      const optIns = Array.isArray(c.alertTypeOptIns)
        ? c.alertTypeOptIns.filter((t): t is 'MISSING_ACK' | 'REJECTION_RATE_SPIKE' | 'STALE_TRAFFIC' =>
            t === 'MISSING_ACK' || t === 'REJECTION_RATE_SPIKE' || t === 'STALE_TRAFFIC',
          )
        : undefined;
      return {
        name: String(c.name ?? ''),
        email: String(c.email ?? ''),
        role: String(c.role ?? ''),
        slackWebhook: typeof c.slackWebhook === 'string' && c.slackWebhook.length > 0
          ? c.slackWebhook
          : undefined,
        alertTypeOptIns: optIns,
      };
    })
    .filter((c) => c.email.length > 0);
}


function isLifecycleDirection(v: unknown): v is LifecycleDirection {
  return v === 'inbound' || v === 'outbound' || v === 'unknown';
}

function readLifecycleFlows(raw: unknown): LifecycleFlowDefinition[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((f): f is Record<string, unknown> => typeof f === 'object' && f !== null)
    .map((f) => ({
      name: String(f.name ?? ''),
      entrySetId: String(f.entrySetId ?? ''),
      steps: Array.isArray(f.steps)
        ? (f.steps as Array<Record<string, unknown>>)
            .filter((st): st is Record<string, unknown> => typeof st === 'object' && st !== null)
            .map((st): LifecycleFlowStep => ({
              setId: String(st.setId ?? ''),
              direction: isLifecycleDirection(st.direction) ? st.direction : 'unknown',
            }))
        : [],
    }))
    .filter((f) => f.name.length > 0 && f.entrySetId.length > 0);
}

function readStringMap(raw: unknown): Record<string, string> {
  if (typeof raw !== 'object' || raw === null) return {};
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    if (typeof v === 'string' && v.length > 0) out[k] = v;
  }
  return out;
}

function readSlaWindows(raw: unknown): PartnerSlaWindow[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((w): w is Record<string, unknown> => typeof w === 'object' && w !== null)
    .map((w) => {
      const within = Number(w.withinMinutes);
      return {
        setId: String(w.setId ?? ''),
        direction: isLifecycleDirection(w.direction) ? w.direction : 'unknown',
        withinMinutes: Number.isFinite(within) && within > 0 ? Math.floor(within) : 0,
        expectedAckSetId: typeof w.expectedAckSetId === 'string' ? w.expectedAckSetId : undefined,
      };
    })
    .filter((w) => w.setId.length > 0 && w.withinMinutes > 0);
}

function isConnectivityChannel(v: unknown): v is ConnectivityChannel {
  return typeof v === 'string' && (CONNECTIVITY_CHANNELS as readonly string[]).includes(v);
}

/** Defensive read for the connectivity JSONB. Returns null when:
 *   - the column is the default '{}' (not yet configured), or
 *   - any of the three required fields is missing / blank, or
 *   - `channel` isn't one of the known values.
 *  Notes is preserved when present and non-empty. */
function readConnectivity(raw: unknown): PartnerConnectivity | null {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return null;
  const r = raw as Record<string, unknown>;
  if (!isConnectivityChannel(r.channel)) return null;
  const endpoint = typeof r.endpoint === 'string' ? r.endpoint.trim() : '';
  const technicalContact = typeof r.technicalContact === 'string' ? r.technicalContact.trim() : '';
  if (!endpoint || !technicalContact) return null;
  const notes = typeof r.notes === 'string' && r.notes.length > 0 ? r.notes : undefined;
  return { channel: r.channel, endpoint, technicalContact, notes };
}

function readAckOverrides(raw: unknown): AckCodeOverrides {
  if (typeof raw !== 'object' || raw === null) return {};
  const r = raw as Record<string, unknown>;
  const out: AckCodeOverrides = {};
  const ak304 = readStringMap(r.AK304);
  const ak403 = readStringMap(r.AK403);
  const ak501 = readStringMap(r.AK501);
  const ak901 = readStringMap(r.AK901);
  if (Object.keys(ak304).length) out.AK304 = ak304;
  if (Object.keys(ak403).length) out.AK403 = ak403;
  if (Object.keys(ak501).length) out.AK501 = ak501;
  if (Object.keys(ak901).length) out.AK901 = ak901;
  return out;
}

export function toRecord(row: DbPartnerRow): TradingPartnerRecord {
  return {
    id: row.id,
    tenantId: row.tenantId,
    displayName: row.displayName,
    isaSenderIds: row.isaSenderIds,
    isaReceiverIds: row.isaReceiverIds,
    status: row.status,
    notes: row.notes,
    contacts: readContacts(row.contacts),
    supportedSets: Array.isArray(row.supportedSets) ? row.supportedSets.slice() : [],
    lifecycleFlows: readLifecycleFlows(row.lifecycleFlows),
    ackCodeOverrides: readAckOverrides(row.ackCodeOverrides),
    slaWindows: readSlaWindows(row.slaWindows),
    connectivity: readConnectivity(row.connectivity),
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

/** Validate the user-supplied input shape, throwing a typed error if invalid.
 *  This is intentionally light-touch: enforce the few invariants that matter,
 *  leave display-name length etc. to the UI. */
export class PartnerValidationError extends Error {
  constructor(message: string, public readonly field?: string) {
    super(message);
    this.name = 'PartnerValidationError';
  }
}

export function validatePartnerInput(input: PartnerConfigInput): void {
  if (!input.displayName || input.displayName.trim().length === 0) {
    throw new PartnerValidationError('displayName is required.', 'displayName');
  }
  if (!Array.isArray(input.isaSenderIds) || !Array.isArray(input.isaReceiverIds)) {
    throw new PartnerValidationError('isaSenderIds and isaReceiverIds must be arrays.');
  }
  for (const id of [...input.isaSenderIds, ...input.isaReceiverIds]) {
    if (typeof id !== 'string' || id.trim().length === 0) {
      throw new PartnerValidationError('ISA IDs must be non-empty strings.');
    }
  }
  // Within a single partner, the same ID can't appear twice on the same side.
  if (new Set(input.isaSenderIds).size !== input.isaSenderIds.length) {
    throw new PartnerValidationError('Duplicate ISA sender ID within this partner.', 'isaSenderIds');
  }
  if (new Set(input.isaReceiverIds).size !== input.isaReceiverIds.length) {
    throw new PartnerValidationError(
      'Duplicate ISA receiver ID within this partner.',
      'isaReceiverIds',
    );
  }
  if (input.supportedSets) {
    for (const set of input.supportedSets) {
      if (typeof set !== 'string' || set.trim().length === 0) {
        throw new PartnerValidationError('supportedSets entries must be non-empty strings.', 'supportedSets');
      }
    }
  }
  if (input.lifecycleFlows) {
    for (const flow of input.lifecycleFlows) {
      if (!flow.name || !flow.entrySetId) {
        throw new PartnerValidationError('Each lifecycle flow needs a name and entrySetId.', 'lifecycleFlows');
      }
      if (!Array.isArray(flow.steps)) {
        throw new PartnerValidationError('lifecycleFlows.steps must be an array.', 'lifecycleFlows');
      }
    }
  }
  if (input.ackCodeOverrides) {
    for (const field of ['AK304', 'AK403', 'AK501', 'AK901'] as const) {
      const map = input.ackCodeOverrides[field];
      if (map !== undefined && (typeof map !== 'object' || map === null || Array.isArray(map))) {
        throw new PartnerValidationError(
          `ackCodeOverrides.${field} must be an object mapping codes to strings.`,
          `ackCodeOverrides.${field}`,
        );
      }
    }
  }
  if (input.slaWindows) {
    for (const w of input.slaWindows) {
      if (!w.setId || typeof w.setId !== 'string') {
        throw new PartnerValidationError('slaWindows.setId is required.', 'slaWindows');
      }
      if (!Number.isInteger(w.withinMinutes) || w.withinMinutes <= 0) {
        throw new PartnerValidationError(
          'slaWindows.withinMinutes must be a positive integer.',
          'slaWindows',
        );
      }
    }
  }
  // Phase 8 Sprint 3 — connectivity. `null` (explicit clear) and `undefined`
  // (omitted on PATCH) both bypass validation. Anything else must satisfy
  // the Gate C shape: { channel, endpoint, technicalContact, notes? }.
  if (input.connectivity !== undefined && input.connectivity !== null) {
    const c = input.connectivity;
    if (!isConnectivityChannel(c.channel)) {
      throw new PartnerValidationError(
        `connectivity.channel must be one of ${CONNECTIVITY_CHANNELS.join(', ')}.`,
        'connectivity.channel',
      );
    }
    if (typeof c.endpoint !== 'string' || c.endpoint.trim().length === 0) {
      throw new PartnerValidationError(
        'connectivity.endpoint is required.',
        'connectivity.endpoint',
      );
    }
    if (typeof c.technicalContact !== 'string' || c.technicalContact.trim().length === 0) {
      throw new PartnerValidationError(
        'connectivity.technicalContact is required.',
        'connectivity.technicalContact',
      );
    }
    // Loose email check — we just want to catch obvious typos, not enforce
    // RFC 5321. The ops team triages bad emails downstream when alerts bounce.
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(c.technicalContact.trim())) {
      throw new PartnerValidationError(
        'connectivity.technicalContact must look like an email address.',
        'connectivity.technicalContact',
      );
    }
    if (c.notes !== undefined && typeof c.notes !== 'string') {
      throw new PartnerValidationError(
        'connectivity.notes must be a string when provided.',
        'connectivity.notes',
      );
    }
  }
}

/** Conflict surface: returns the offending partner(s) so the UI can name them. */
export interface IsaOverlap {
  partnerId: string;
  displayName: string;
  conflicts: Array<{ side: 'sender' | 'receiver'; value: string }>;
}

/** Gate E enforcement. Throws `PartnerConflictError` with details when any
 *  ISA ID in `input` is already owned by another partner. */
export class PartnerConflictError extends Error {
  constructor(public readonly overlaps: IsaOverlap[]) {
    super('ISA identifiers overlap with one or more other configured partners.');
    this.name = 'PartnerConflictError';
  }
}

export async function assertNoIsaOverlap(
  prisma: PrismaClient,
  input: PartnerConfigInput,
  excludePartnerId?: string,
): Promise<void> {
  const sender = input.isaSenderIds;
  const receiver = input.isaReceiverIds;
  if (sender.length === 0 && receiver.length === 0) return;

  // Desktop track D1 Sprint 1 — Option A (app-side filtering). The prior
  // implementation used Postgres-native `hasSome` operators, which don't
  // translate to the SQLite JSON-encoded column shape. The tenant extension
  // already scopes findMany to the current tenant, and a tenant's partner
  // list is small (handful to a few hundred), so we read the candidate list
  // and do membership checks in JS. Same algorithm runs identically on
  // Postgres and SQLite — no provider branching here.
  type Row = { id: string; displayName: string; isaSenderIds: string[]; isaReceiverIds: string[] };
  const senderSet = new Set(sender);
  const receiverSet = new Set(receiver);

  const candidates = (await prisma.tradingPartner.findMany({
    where: excludePartnerId ? { id: { not: excludePartnerId } } : undefined,
    select: { id: true, displayName: true, isaSenderIds: true, isaReceiverIds: true },
  })) as unknown as Row[];

  const overlaps: IsaOverlap[] = [];
  for (const o of candidates) {
    const conflicts: IsaOverlap['conflicts'] = [];
    for (const id of o.isaSenderIds) if (senderSet.has(id)) conflicts.push({ side: 'sender', value: id });
    for (const id of o.isaReceiverIds) if (receiverSet.has(id)) conflicts.push({ side: 'receiver', value: id });
    if (conflicts.length > 0) overlaps.push({ partnerId: o.id, displayName: o.displayName, conflicts });
  }
  if (overlaps.length > 0) throw new PartnerConflictError(overlaps);
}

/** List all configured partners, newest first. */
export async function listPartners(prisma: PrismaClient): Promise<TradingPartnerRecord[]> {
  const rows = (await prisma.tradingPartner.findMany({
    orderBy: { createdAt: 'desc' },
  })) as unknown as DbPartnerRow[];
  return rows.map(toRecord);
}

export async function getPartner(prisma: PrismaClient, id: string): Promise<TradingPartnerRecord | null> {
  const row = (await prisma.tradingPartner.findUnique({ where: { id } })) as unknown as DbPartnerRow | null;
  return row ? toRecord(row) : null;
}

/**
 * Resolve a configured partner from an interchange's ISA pair. The partner is
 * whichever record claims the trading-partner ID — i.e. the side that ISN'T
 * the hub operator (per OUR_ISA_IDS). When neither side is "us" we try both;
 * unknown ISA IDs return null.
 */
export async function resolvePartnerByIsa(
  prisma: PrismaClient,
  senderId: string,
  receiverId: string,
  ourIsaIds: readonly string[],
): Promise<TradingPartnerRecord | null> {
  const senderCandidates = new Set<string>();
  const receiverCandidates = new Set<string>();
  if (ourIsaIds.length === 0) {
    if (senderId) senderCandidates.add(senderId);
    if (receiverId) receiverCandidates.add(receiverId);
  } else {
    if (senderId && !ourIsaIds.includes(senderId)) senderCandidates.add(senderId);
    if (receiverId && !ourIsaIds.includes(receiverId)) receiverCandidates.add(receiverId);
  }
  if (senderCandidates.size === 0 && receiverCandidates.size === 0) return null;

  // Desktop track D1 Sprint 1 - Option A (app-side filtering). The prior
  // implementation used Postgres-native `has` operators which don't translate
  // to SQLite. The tenant extension already scopes findMany to the current
  // tenant; partner lists are small, so we read the (tenant-scoped) list and
  // do membership in JS. Same algorithm runs identically on both providers.
  const rows = (await prisma.tradingPartner.findMany()) as unknown as DbPartnerRow[];
  const match = rows.find(
    (row) =>
      row.isaSenderIds.some((id) => senderCandidates.has(id)) ||
      row.isaReceiverIds.some((id) => receiverCandidates.has(id)),
  );
  return match ? toRecord(match) : null;
}

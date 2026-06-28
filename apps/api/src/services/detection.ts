/**
 * Phase 7 Sprint 1 — detection engine.
 *
 * Two independent detectors:
 *
 *   `detectMissingAcks`  — for each configured partner with `slaWindows`,
 *      finds transactions in the SLA's (set, direction) window whose matching
 *      997 hasn't arrived inside `withinMinutes`. Emits MISSING_ACK alerts
 *      with a dedupeKey derived from the originating txn id so reruns don't
 *      multiply.
 *
 *   `detectRejectionSpikes` — per partner, computes the current 24h
 *      rejection rate and compares against the 30-day rolling baseline.
 *      Emits REJECTION_RATE_SPIKE alerts when the jump exceeds Gate D's
 *      threshold (absolute ≥ 10pp when baseline < 5%, or relative ≥ 3x
 *      when baseline ≥ 5%).
 *
 * Both detectors are pure callable services. The CLI runner
 * (`scripts/run-detection.ts`) invokes them once per pass. Sprint 2 wires the
 * BullMQ scheduler on top.
 */
import type { PrismaClient } from '@prisma/client';
import type { LifecycleDirection, PartnerSlaWindow } from '@edi/shared';
import { createAlert } from './alerts.js';
import { notify, type NotifierDeps } from './notifier.js';
import type { PartnerContact } from '@edi/shared';

function readContacts(raw: unknown): PartnerContact[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((c): c is Record<string, unknown> => typeof c === 'object' && c !== null)
    .map((c) => ({
      name: String(c.name ?? ''),
      email: String(c.email ?? ''),
      role: String(c.role ?? ''),
      slackWebhook: typeof c.slackWebhook === 'string' && c.slackWebhook.length > 0 ? c.slackWebhook : undefined,
      alertTypeOptIns: Array.isArray(c.alertTypeOptIns)
        ? c.alertTypeOptIns.filter((t): t is 'MISSING_ACK' | 'REJECTION_RATE_SPIKE' | 'STALE_TRAFFIC' | 'UNKNOWN_ISA' =>
            t === 'MISSING_ACK' || t === 'REJECTION_RATE_SPIKE' || t === 'STALE_TRAFFIC' || t === 'UNKNOWN_ISA',
          )
        : undefined,
    }))
    .filter((c) => c.email.length > 0);
}

export interface DetectionResult {
  emitted: number;
  notified: number;
}

/** Optional notifier deps. When omitted, detection writes alerts but never
 *  dispatches — useful when the caller wants pure detection. */
export interface DetectionOptions {
  notifier?: NotifierDeps;
  /** Phase 7 Sprint 3 — initial suppressUntil = now + this many minutes (Gate G).
   *  Only applied on a brand-new alert; existing rows keep their value. */
  suppressionMinutes?: number;
}

// ─────────────────────────────────────────────────────────────
// Missing-ack detector
// ─────────────────────────────────────────────────────────────

interface PartnerRow {
  id: string;
  displayName: string;
  isaSenderIds: string[];
  isaReceiverIds: string[];
  slaWindows: unknown;
  contacts: unknown;
}

interface TxnRow {
  id: string;
  transactionSetId: string;
  controlNumber: string;
  direction: LifecycleDirection;
  poNumber: string | null;
  functionalGroup: {
    controlNumber: string;
    interchange: {
      senderId: string;
      receiverId: string;
      rawFile: { ingestedAt: Date };
    };
  };
}

function readSlaWindows(raw: unknown): PartnerSlaWindow[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((w): w is Record<string, unknown> => typeof w === 'object' && w !== null)
    .map((w) => {
      const within = Number(w.withinMinutes);
      return {
        setId: String(w.setId ?? ''),
        direction: (w.direction === 'inbound' || w.direction === 'outbound' || w.direction === 'unknown'
          ? w.direction
          : 'unknown') as LifecycleDirection,
        withinMinutes: Number.isFinite(within) && within > 0 ? Math.floor(within) : 0,
        expectedAckSetId: typeof w.expectedAckSetId === 'string' ? w.expectedAckSetId : '997',
      } satisfies PartnerSlaWindow;
    })
    .filter((w) => w.setId.length > 0 && w.withinMinutes > 0);
}

export async function detectMissingAcks(
  prisma: PrismaClient,
  now: Date = new Date(),
  options: DetectionOptions = {},
): Promise<DetectionResult> {
  const partners = (await prisma.tradingPartner.findMany({
    where: { status: 'active' },
  })) as unknown as PartnerRow[];

  let emitted = 0;
  let notified = 0;
  for (const partner of partners) {
    const slas = readSlaWindows(partner.slaWindows);
    if (slas.length === 0) continue;
    const partnerIsaIds = new Set([...(partner.isaSenderIds ?? []), ...(partner.isaReceiverIds ?? [])]);

    for (const sla of slas) {
      // Candidate transactions: matching set, matching direction, ingested at
      // least `withinMinutes` ago (so they SHOULD have an ack by now), but not
      // older than 7 days (don't alert on ancient history).
      const slaCutoff = new Date(now.getTime() - sla.withinMinutes * 60 * 1000);
      const horizon = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);

      const candidates = (await prisma.transaction.findMany({
        where: {
          transactionSetId: sla.setId,
          direction: sla.direction,
          functionalGroup: {
            interchange: {
              rawFile: { ingestedAt: { gte: horizon, lte: slaCutoff } },
              // Limit to this partner: sender or receiver must be one of theirs.
              OR: [
                { senderId: { in: [...partnerIsaIds] } },
                { receiverId: { in: [...partnerIsaIds] } },
              ],
            },
          },
        },
        include: {
          functionalGroup: { include: { interchange: { include: { rawFile: true } } } },
        },
      })) as unknown as TxnRow[];

      for (const txn of candidates) {
        // Already acked? Look for a 997/999 whose ackedGroupControl matches
        // the txn's group AND whose ackedTxnControls JSON contains the txn's
        // setId+controlNumber.
        const groupControl = txn.functionalGroup.controlNumber;
        const acks = (await prisma.transaction.findMany({
          where: {
            transactionSetId: { in: [sla.expectedAckSetId ?? '997', '999'] },
            ackedGroupControl: groupControl,
          },
          select: { ackedTxnControls: true },
        })) as unknown as Array<{ ackedTxnControls: unknown }>;

        const isAcked = acks.some((a) => {
          if (!Array.isArray(a.ackedTxnControls)) return false;
          return (a.ackedTxnControls as Array<Record<string, unknown>>).some(
            (e) =>
              e &&
              typeof e === 'object' &&
              String(e.setId ?? '') === txn.transactionSetId &&
              String(e.control ?? '') === txn.controlNumber,
          );
        });
        if (isAcked) continue;

        // Emit. dedupeKey is per-transaction so this fires once per missing ack.
        const dedupeKey = `MISSING_ACK::${partner.id}::${txn.id}`;
        const overdueMinutes = Math.floor(
          (now.getTime() - txn.functionalGroup.interchange.rawFile.ingestedAt.getTime()) / 60000,
        );
        const result = await createAlert(prisma, {
          partnerId: partner.id,
          type: 'MISSING_ACK',
          severity: 'warning',
          title: `${partner.displayName}: ${txn.transactionSetId} ${txn.direction} missing 997 ack`,
          body:
            `Transaction ${txn.transactionSetId} #${txn.controlNumber} (${txn.direction}) for ` +
            `${partner.displayName} has not been acknowledged. SLA: within ${sla.withinMinutes} minutes; ` +
            `currently ${overdueMinutes} minutes since ingestion.`,
          dedupeKey,
          sourceRef: {
            transactionId: txn.id,
            transactionSetId: txn.transactionSetId,
            controlNumber: txn.controlNumber,
            groupControl,
            withinMinutes: sla.withinMinutes,
            overdueMinutes,
            poNumber: txn.poNumber,
          },
          now,
          suppressUntil: options.suppressionMinutes
            ? new Date(now.getTime() + options.suppressionMinutes * 60 * 1000)
            : null,
        });
        emitted += 1;
        if (options.notifier && (result.outcome === 'created' || result.outcome === 'reactivated')) {
          const r = await notify(options.notifier, result.alert, {
            id: partner.id, displayName: partner.displayName,
            contacts: readContacts((partner as unknown as { contacts: unknown }).contacts),
          });
          if (r.recipients.length > 0) notified += 1;
        }
      }
    }
  }
  return { emitted, notified };
}

// ─────────────────────────────────────────────────────────────
// Rejection-rate spike detector (Gate D)
// ─────────────────────────────────────────────────────────────

const DAY_MS = 24 * 60 * 60 * 1000;
const BASELINE_WINDOW_DAYS = 30;
const CURRENT_WINDOW_HOURS = 24;
const SPIKE_ABSOLUTE_PP = 0.10;          // ≥10 percentage points when baseline < 5%
const SPIKE_RELATIVE_MULTIPLIER = 3;     // ≥3x baseline when baseline ≥ 5%
const SPIKE_BASELINE_PIVOT = 0.05;       // 5%
const MIN_TOTAL_FOR_SPIKE = 10;          // Don't fire on tiny denominators

interface AckRow {
  ackedTxnControls: unknown;
  functionalGroup: {
    interchange: {
      senderId: string;
      receiverId: string;
      rawFile: { ingestedAt: Date };
    };
  };
}

function partnerOwns(senderId: string, receiverId: string, partnerIsa: Set<string>): boolean {
  return partnerIsa.has(senderId) || partnerIsa.has(receiverId);
}

function countRejections(rows: AckRow[], partnerIsa: Set<string>): { total: number; rejected: number } {
  let total = 0;
  let rejected = 0;
  for (const row of rows) {
    if (!partnerOwns(row.functionalGroup.interchange.senderId, row.functionalGroup.interchange.receiverId, partnerIsa)) continue;
    if (!Array.isArray(row.ackedTxnControls)) continue;
    for (const e of row.ackedTxnControls as Array<Record<string, unknown>>) {
      if (!e || typeof e !== 'object') continue;
      total += 1;
      const status = String(e.status ?? '');
      if (status === 'R' || status === 'M') rejected += 1;
    }
  }
  return { total, rejected };
}

function isSpike(baselineRate: number, currentRate: number): boolean {
  if (baselineRate < SPIKE_BASELINE_PIVOT) {
    return currentRate - baselineRate >= SPIKE_ABSOLUTE_PP;
  }
  return currentRate >= baselineRate * SPIKE_RELATIVE_MULTIPLIER;
}

export async function detectRejectionSpikes(
  prisma: PrismaClient,
  now: Date = new Date(),
  options: DetectionOptions = {},
): Promise<DetectionResult> {
  const partners = (await prisma.tradingPartner.findMany({
    where: { status: 'active' },
  })) as unknown as PartnerRow[];

  // Pull once over the longer baseline window (covers current too).
  const baselineFrom = new Date(now.getTime() - BASELINE_WINDOW_DAYS * DAY_MS);
  const currentFrom = new Date(now.getTime() - CURRENT_WINDOW_HOURS * 60 * 60 * 1000);

  const rows = (await prisma.transaction.findMany({
    where: {
      transactionSetId: { in: ['997', '999'] },
      functionalGroup: { interchange: { rawFile: { ingestedAt: { gte: baselineFrom, lte: now } } } },
    },
    include: { functionalGroup: { include: { interchange: { include: { rawFile: true } } } } },
  })) as unknown as AckRow[];

  let emitted = 0;
  let notified = 0;
  for (const partner of partners) {
    const partnerIsa = new Set([...(partner.isaSenderIds ?? []), ...(partner.isaReceiverIds ?? [])]);
    if (partnerIsa.size === 0) continue;
    const currentRows = rows.filter(
      (r) => r.functionalGroup.interchange.rawFile.ingestedAt.getTime() >= currentFrom.getTime(),
    );
    const { total, rejected } = countRejections(currentRows, partnerIsa);
    const baselineCounts = countRejections(rows, partnerIsa);
    if (baselineCounts.total < MIN_TOTAL_FOR_SPIKE) continue;
    const baselineRate = baselineCounts.rejected / baselineCounts.total;
    const currentRate = total > 0 ? rejected / total : 0;
    if (!isSpike(baselineRate, currentRate)) continue;

    // Dedupe on (partner, type, day) so we get at most one spike alert per day.
    const day = now.toISOString().slice(0, 10);
    const dedupeKey = `REJECTION_RATE_SPIKE::${partner.id}::${day}`;
    const baselinePct = (baselineRate * 100).toFixed(1);
    const currentPct = (currentRate * 100).toFixed(1);
    const result = await createAlert(prisma, {
      partnerId: partner.id,
      type: 'REJECTION_RATE_SPIKE',
      severity: 'critical',
      title: `${partner.displayName}: rejection rate spiked to ${currentPct}%`,
      body:
        `In the last 24 hours, ${partner.displayName} rejected ${rejected} of ${total} ` +
        `transactions (${currentPct}%) vs a 30-day baseline of ${baselinePct}%.`,
      dedupeKey,
      sourceRef: {
        baselineRate,
        currentRate,
        baselineTotal: baselineCounts.total,
        baselineRejected: baselineCounts.rejected,
        currentTotal: total,
        currentRejected: rejected,
      },
      now,
      suppressUntil: options.suppressionMinutes
        ? new Date(now.getTime() + options.suppressionMinutes * 60 * 1000)
        : null,
    });
    emitted += 1;
    if (options.notifier && (result.outcome === 'created' || result.outcome === 'reactivated')) {
      const r = await notify(options.notifier, result.alert, {
        id: partner.id, displayName: partner.displayName,
        contacts: readContacts((partner as unknown as { contacts: unknown }).contacts),
      });
      if (r.recipients.length > 0) notified += 1;
    }
  }
  return { emitted, notified };
}

// ─────────────────────────────────────────────────────────────
// PS-4 — Stale traffic + unknown ISA detectors
// ─────────────────────────────────────────────────────────────

const DEFAULT_GLOBAL_STALE_HOURS = 6;

function maxSlaMinutes(slaWindows: unknown): number {
  const slas = readSlaWindows(slaWindows);
  if (slas.length === 0) return 0;
  return Math.max(...slas.map((s) => s.withinMinutes));
}

/** F2 tier 1 — no ingest from any partner in the global stale window. */
export async function detectGlobalStaleTraffic(
  prisma: PrismaClient,
  now: Date = new Date(),
  options: DetectionOptions & { staleWindowHours?: number } = {},
): Promise<DetectionResult> {
  const hours = options.staleWindowHours ?? DEFAULT_GLOBAL_STALE_HOURS;
  const cutoff = new Date(now.getTime() - hours * 60 * 60 * 1000);
  const latest = await prisma.rawFile.findFirst({
    orderBy: { ingestedAt: 'desc' },
    select: { ingestedAt: true },
  });
  let emitted = 0;
  if (!latest || latest.ingestedAt < cutoff) {
    const dedupeKey = `STALE_TRAFFIC::global::${now.toISOString().slice(0, 10)}`;
    await createAlert(prisma, {
      partnerId: null,
      type: 'STALE_TRAFFIC',
      severity: 'critical',
      title: 'No EDI traffic from any partner',
      body: `No file ingested in the last ${hours} hour(s). Last ingest: ${
        latest ? latest.ingestedAt.toISOString() : 'never'
      }.`,
      dedupeKey,
      sourceRef: { scope: 'global', staleWindowHours: hours, lastIngestAt: latest?.ingestedAt.toISOString() ?? null },
      now,
      suppressUntil: options.suppressionMinutes
        ? new Date(now.getTime() + options.suppressionMinutes * 60 * 1000)
        : null,
    });
    emitted += 1;
  }
  return { emitted, notified: 0 };
}

/** F2 tier 2 — per-partner stale when partner has SLA windows (2× longest SLA). */
export async function detectPartnerStaleTraffic(
  prisma: PrismaClient,
  now: Date = new Date(),
  options: DetectionOptions = {},
): Promise<DetectionResult> {
  const partners = (await prisma.tradingPartner.findMany({
    where: { status: 'active' },
  })) as unknown as PartnerRow[];

  let emitted = 0;
  for (const partner of partners) {
    const maxSla = maxSlaMinutes(partner.slaWindows);
    if (maxSla <= 0) continue;
    const windowMs = maxSla * 2 * 60 * 1000;
    const cutoff = new Date(now.getTime() - windowMs);
    const isaIds = [...(partner.isaSenderIds ?? []), ...(partner.isaReceiverIds ?? [])];
    if (isaIds.length === 0) continue;

    const latest = await prisma.rawFile.findFirst({
      where: {
        interchange: {
          OR: [
            { senderId: { in: isaIds } },
            { receiverId: { in: isaIds } },
          ],
        },
      },
      orderBy: { ingestedAt: 'desc' },
      select: { ingestedAt: true },
    });

    if (latest && latest.ingestedAt >= cutoff) continue;

    const dedupeKey = `STALE_TRAFFIC::partner::${partner.id}::${now.toISOString().slice(0, 10)}`;
    await createAlert(prisma, {
      partnerId: partner.id,
      type: 'STALE_TRAFFIC',
      severity: 'warning',
      title: `${partner.displayName}: no recent EDI traffic`,
      body: `No ingest in ${maxSla * 2} minutes (2× longest SLA). Last: ${
        latest ? latest.ingestedAt.toISOString() : 'never'
      }.`,
      dedupeKey,
      sourceRef: {
        scope: 'partner',
        partnerId: partner.id,
        windowMinutes: maxSla * 2,
        lastIngestAt: latest?.ingestedAt.toISOString() ?? null,
      },
      now,
      suppressUntil: options.suppressionMinutes
        ? new Date(now.getTime() + options.suppressionMinutes * 60 * 1000)
        : null,
    });
    emitted += 1;
  }
  return { emitted, notified: 0 };
}

/** F49 — unknown ISA sender/receiver after recent ingest. */
export async function detectUnknownIsaSenders(
  prisma: PrismaClient,
  now: Date = new Date(),
  options: DetectionOptions = {},
): Promise<DetectionResult> {
  const horizon = new Date(now.getTime() - 24 * 60 * 60 * 1000);
  const partners = (await prisma.tradingPartner.findMany({
    where: { status: 'active' },
    select: { isaSenderIds: true, isaReceiverIds: true },
  })) as Array<{ isaSenderIds: string[]; isaReceiverIds: string[] }>;

  const knownIsa = new Set<string>();
  for (const p of partners) {
    for (const id of [...p.isaSenderIds, ...p.isaReceiverIds]) knownIsa.add(id);
  }

  const recent = await prisma.interchange.findMany({
    where: { rawFile: { ingestedAt: { gte: horizon } } },
    select: { senderId: true, receiverId: true, rawFileId: true },
    distinct: ['senderId', 'receiverId'],
  });

  let emitted = 0;
  for (const ic of recent) {
    const unknownSender = !knownIsa.has(ic.senderId);
    const unknownReceiver = !knownIsa.has(ic.receiverId);
    if (!unknownSender && !unknownReceiver) continue;

    const dedupeKey = `UNKNOWN_ISA::${ic.senderId}::${ic.receiverId}`;
    await createAlert(prisma, {
      partnerId: null,
      type: 'UNKNOWN_ISA',
      severity: 'warning',
      title: `Unknown ISA pair: ${ic.senderId} → ${ic.receiverId}`,
      body: 'Interchange sender/receiver IDs match no configured trading partner.',
      dedupeKey,
      sourceRef: {
        senderId: ic.senderId,
        receiverId: ic.receiverId,
        rawFileId: ic.rawFileId,
      },
      now,
      suppressUntil: options.suppressionMinutes
        ? new Date(now.getTime() + options.suppressionMinutes * 60 * 1000)
        : null,
    });
    emitted += 1;
  }
  return { emitted, notified: 0 };
}

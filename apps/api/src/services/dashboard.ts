/**
 * PS-3 — Ops dashboard aggregates (F1, F45–F48, F3).
 */
import type { PrismaClient } from '@prisma/client';
import type {
  DashboardIngestWindow,
  DashboardResponse,
  RawFileStatus,
} from '@edi/shared';
import { getRejectionRate } from './metrics.js';

const DEFAULT_STALE_HOURS = 6;
const MS_HOUR = 60 * 60 * 1000;
const MS_DAY = 24 * MS_HOUR;

function ingestWindowStart(window: DashboardIngestWindow, now: Date): Date | null {
  switch (window) {
    case '24h': return new Date(now.getTime() - 24 * MS_HOUR);
    case '7d': return new Date(now.getTime() - 7 * MS_DAY);
    case '30d': return new Date(now.getTime() - 30 * MS_DAY);
    case 'all': return null;
  }
}

export interface GetDashboardInput {
  ingestWindow?: DashboardIngestWindow;
  rejectionWindowDays?: 7 | 30;
  ourIsaIds: readonly string[];
  staleWindowHours?: number;
  now?: Date;
}

export async function getDashboard(
  prisma: PrismaClient,
  input: GetDashboardInput,
): Promise<DashboardResponse> {
  const now = input.now ?? new Date();
  const ingestWindow = input.ingestWindow ?? '24h';
  const rejectionWindowDays = input.rejectionWindowDays ?? 7;
  const staleHours = input.staleWindowHours ?? DEFAULT_STALE_HOURS;

  const partners = await prisma.tradingPartner.findMany({
    where: { status: 'active' },
    select: { id: true, displayName: true, isaSenderIds: true, isaReceiverIds: true },
  });

  const latestGlobal = await prisma.rawFile.findFirst({
    orderBy: { ingestedAt: 'desc' },
    select: { ingestedAt: true },
  });
  const lastGlobal = latestGlobal?.ingestedAt ?? null;
  const staleCutoff = new Date(now.getTime() - staleHours * MS_HOUR);
  const isGloballyStale = !lastGlobal || lastGlobal < staleCutoff;

  const partnerLastIngest = new Map<string, Date>();
  for (const p of partners) {
    const isaIds = [...p.isaSenderIds, ...p.isaReceiverIds];
    if (isaIds.length === 0) continue;
    const row = await prisma.rawFile.findFirst({
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
    if (row) partnerLastIngest.set(p.id, row.ingestedAt);
  }

  const activeAlerts = await prisma.alert.findMany({
    where: { status: 'active' },
    select: { severity: true, partnerId: true, type: true },
  });
  const missingAckByPartner = new Map<string, number>();
  for (const a of activeAlerts) {
    if (a.type === 'MISSING_ACK' && a.partnerId) {
      missingAckByPartner.set(a.partnerId, (missingAckByPartner.get(a.partnerId) ?? 0) + 1);
    }
  }
  const bySeverity = { critical: 0, warning: 0, info: 0 };
  const alertsByPartner = new Map<string | null, number>();
  for (const a of activeAlerts) {
    if (a.severity === 'critical') bySeverity.critical += 1;
    else if (a.severity === 'warning') bySeverity.warning += 1;
    else bySeverity.info += 1;
    alertsByPartner.set(a.partnerId, (alertsByPartner.get(a.partnerId) ?? 0) + 1);
  }
  const partnerName = new Map(partners.map((p) => [p.id, p.displayName]));
  const topPartners = [...alertsByPartner.entries()]
    .map(([partnerId, count]) => ({
      partnerId,
      displayName: partnerId ? (partnerName.get(partnerId) ?? partnerId) : 'Global',
      count,
    }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 10);

  const ingestFrom = ingestWindowStart(ingestWindow, now);
  const ingestRows = await prisma.rawFile.groupBy({
    by: ['status'],
    where: ingestFrom ? { ingestedAt: { gte: ingestFrom } } : undefined,
    _count: { _all: true },
  });
  const ingestCounts: Record<RawFileStatus, number> = {
    RECEIVED: 0, DUPLICATE: 0, PARSED: 0, PARSE_ERROR: 0,
    UNRECOGNIZED_FORMAT: 0, FAILED: 0, ARCHIVED: 0,
  };
  for (const row of ingestRows) {
    ingestCounts[row.status as RawFileStatus] = row._count._all;
  }

  const rejectionFrom = new Date(now.getTime() - rejectionWindowDays * MS_DAY);
  const rejectionRows = await getRejectionRate(prisma, {
    from: rejectionFrom,
    to: now,
    ourIsaIds: input.ourIsaIds,
  });
  const topRejectionPartners = rejectionRows.slice(0, 5);

  const trends: DashboardResponse['rejectionTrends']['trends'] = [];
  for (const row of topRejectionPartners) {
    const dailyRates: number[] = [];
    for (let d = rejectionWindowDays - 1; d >= 0; d -= 1) {
      const dayEnd = new Date(now.getTime() - d * MS_DAY);
      const dayStart = new Date(dayEnd.getTime() - MS_DAY);
      const dayRows = await getRejectionRate(prisma, {
        from: dayStart,
        to: dayEnd,
        partner: row.partner,
        ourIsaIds: input.ourIsaIds,
      });
      dailyRates.push(dayRows[0]?.rate ?? 0);
    }
    trends.push({ partner: row.partner, dailyRates });
  }

  const rate30d = await getRejectionRate(prisma, {
    from: new Date(now.getTime() - 30 * MS_DAY),
    to: now,
    ourIsaIds: input.ourIsaIds,
  });
  const rate30dMap = new Map(rate30d.map((r) => [r.partner, r.rate]));

  const partnerHealth = partners.map((p) => {
    const isaIds = [...p.isaSenderIds, ...p.isaReceiverIds];
    const lastIngest = partnerLastIngest.get(p.id) ?? null;
    return {
      partnerId: p.id,
      displayName: p.displayName,
      lastIngestAt: lastIngest?.toISOString() ?? null,
      lastAckAt: null as string | null,
      rejectionRate30d: rate30dMap.get(isaIds[0] ?? p.displayName) ?? 0,
      openAlertCount: alertsByPartner.get(p.id) ?? 0,
      missingAckCount: missingAckByPartner.get(p.id) ?? 0,
    };
  });

  for (const ph of partnerHealth) {
    const p = partners.find((x) => x.id === ph.partnerId);
    if (!p) continue;
    const isaIds = [...p.isaSenderIds, ...p.isaReceiverIds];
    const ackRow = await prisma.transaction.findFirst({
      where: {
        transactionSetId: { in: ['997', '999'] },
        functionalGroup: {
          interchange: {
            OR: [
              { senderId: { in: isaIds } },
              { receiverId: { in: isaIds } },
            ],
          },
        },
      },
      orderBy: { functionalGroup: { interchange: { rawFile: { ingestedAt: 'desc' } } } },
      select: {
        functionalGroup: { select: { interchange: { select: { rawFile: { select: { ingestedAt: true } } } } } },
      },
    });
    ph.lastAckAt = ackRow?.functionalGroup.interchange.rawFile.ingestedAt.toISOString() ?? null;
    const partnerIsa = isaIds.find((id) => rate30dMap.has(id)) ?? p.displayName;
    ph.rejectionRate30d = rate30dMap.get(partnerIsa) ?? ph.rejectionRate30d;
  }

  const recentFailureRows = await prisma.rawFile.findMany({
    where: { status: { in: ['PARSE_ERROR', 'FAILED', 'UNRECOGNIZED_FORMAT'] } },
    orderBy: { ingestedAt: 'desc' },
    take: 8,
    select: {
      id: true,
      status: true,
      errorMessage: true,
      ingestedAt: true,
      isaControlNumber: true,
    },
  });

  return {
    trafficSilence: {
      lastGlobalIngestAt: lastGlobal?.toISOString() ?? null,
      isGloballyStale,
      staleWindowHours: staleHours,
      partners: partners.map((p) => ({
        partnerId: p.id,
        displayName: p.displayName,
        lastIngestAt: partnerLastIngest.get(p.id)?.toISOString() ?? null,
      })),
    },
    openAlerts: {
      total: activeAlerts.length,
      bySeverity,
      topPartners,
    },
    ingestHealth: {
      window: ingestWindow,
      parsed: ingestCounts.PARSED,
      parseError: ingestCounts.PARSE_ERROR + ingestCounts.UNRECOGNIZED_FORMAT,
      failed: ingestCounts.FAILED,
      duplicate: ingestCounts.DUPLICATE,
      received: ingestCounts.RECEIVED,
    },
    rejectionTrends: { windowDays: rejectionWindowDays, trends },
    partnerHealth: partnerHealth.sort((a, b) => b.openAlertCount - a.openAlertCount),
    recentFailures: recentFailureRows.map((r) => ({
      id: r.id,
      status: r.status,
      errorMessage: r.errorMessage,
      ingestedAt: r.ingestedAt.toISOString(),
      isaControlNumber: r.isaControlNumber,
    })),
  };
}

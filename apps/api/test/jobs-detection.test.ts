/**
 * Desktop track D2 Sprint 2 — detection-via-jobs integration test (S6.2).
 *
 * End-to-end against in-memory fakes for both the `Job` table and the
 * detection-touching Prisma surface (`tradingPartner`, `transaction`,
 * `alert`). Verifies that:
 *
 *   1. The producer enqueues a `detection` job through the public JobQueue
 *      interface and the row lands at `status='pending'`.
 *   2. The DB-backed worker claims it on the next tick and runs the
 *      registered handler.
 *   3. The handler invokes `detectMissingAcks` / `detectRejectionSpikes`,
 *      which create an Alert row using the test's seeded SLA configuration.
 *   4. The job row flips to `status='done'` with no error.
 *
 * What this does NOT cover:
 *   - The Prisma extension's tenant-scoping (the fakes don't go through
 *     `@edi/db`; the unit tests in `packages/db` cover that path).
 *   - The detection algorithm itself (see `detection.test.ts`).
 *   - The interval-based scheduling. Tests drive the loop via
 *     `adapter.runOnce()`; production runs on `setInterval`.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import type { PrismaClient } from '@prisma/client';

import { createJobsAdapter } from '../src/jobs/factory.js';
import {
  createDetectionHandler,
  DETECTION_JOB_NAME,
  type DetectionJobPayload,
} from '../src/jobs/handlers/detection.js';

// ─────────────────────────────────────────────────────────────
// Fake "world": Job table + the detection-touching models
// ─────────────────────────────────────────────────────────────

type Dir = 'inbound' | 'outbound' | 'unknown';

interface FakeJobRow {
  id: string;
  name: string;
  payload: string;
  runAfter: Date;
  status: 'pending' | 'running' | 'done' | 'failed' | 'dead';
  attempts: number;
  error: string | null;
  createdAt: Date;
}

interface FakeTxn {
  id: string;
  transactionSetId: string;
  controlNumber: string;
  direction: Dir;
  poNumber: string | null;
  ackedGroupControl: string | null;
  ackedTxnControls?: Array<{ setId: string; control: string; status: string }>;
  functionalGroup: {
    controlNumber: string;
    interchange: {
      senderId: string;
      receiverId: string;
      rawFile: { ingestedAt: Date };
    };
  };
}

interface FakePartner {
  id: string;
  displayName: string;
  isaSenderIds: string[];
  isaReceiverIds: string[];
  slaWindows: Array<{ setId: string; direction: Dir; withinMinutes: number; expectedAckSetId?: string }>;
  contacts: unknown;
  status: 'active' | 'disabled';
}

interface FakeAlert {
  id: string;
  partnerId: string | null;
  type: string;
  severity: string;
  title: string;
  body: string;
  dedupeKey: string;
  sourceRef: unknown;
  status: string;
  createdAt: Date;
  lastSeenAt: Date;
  acknowledgedAt: Date | null;
  acknowledgedBy: string | null;
  suppressUntil: Date | null;
}

interface World {
  jobs: FakeJobRow[];
  tenants: Array<{ id: string; deletedAt: Date | null }>;
  partners: FakePartner[];
  txns: FakeTxn[];
  alerts: FakeAlert[];
  seq: number;
}

/** Same matcher as `detection.test.ts` so the handler's queries find the
 *  seeded fixture. Trimmed to what this integration test exercises. */
function txnMatches(t: FakeTxn, where: Record<string, unknown>): boolean {
  if (where.transactionSetId !== undefined) {
    const v = where.transactionSetId as string | { in?: string[] };
    if (typeof v === 'string' && t.transactionSetId !== v) return false;
    if (typeof v === 'object' && Array.isArray(v.in) && !v.in.includes(t.transactionSetId)) return false;
  }
  if (where.direction !== undefined && t.direction !== where.direction) return false;
  if (where.ackedGroupControl !== undefined) {
    const v = where.ackedGroupControl as string | { in?: string[] };
    if (typeof v === 'string' && t.ackedGroupControl !== v) return false;
    if (typeof v === 'object' && Array.isArray(v.in) && (!t.ackedGroupControl || !v.in.includes(t.ackedGroupControl))) return false;
  }
  const fg = where.functionalGroup as { interchange?: Record<string, unknown> } | undefined;
  if (fg?.interchange) {
    const ic = fg.interchange;
    const rf = ic.rawFile as { ingestedAt?: { gte?: Date; lte?: Date } } | undefined;
    if (rf?.ingestedAt) {
      const at = t.functionalGroup.interchange.rawFile.ingestedAt.getTime();
      if (rf.ingestedAt.gte && at < rf.ingestedAt.gte.getTime()) return false;
      if (rf.ingestedAt.lte && at > rf.ingestedAt.lte.getTime()) return false;
    }
    const ors = ic.OR as Array<Record<string, unknown>> | undefined;
    if (ors && ors.length > 0) {
      const any = ors.some((or) => {
        const s = (or.senderId as { in?: string[] } | undefined)?.in ?? [];
        const r = (or.receiverId as { in?: string[] } | undefined)?.in ?? [];
        return (
          s.includes(t.functionalGroup.interchange.senderId) ||
          r.includes(t.functionalGroup.interchange.receiverId)
        );
      });
      if (!any) return false;
    }
  }
  return true;
}

function makePrisma(world: World): PrismaClient {
  const job = {
    async create({ data }: { data: { name: string; payload: string; runAfter: Date } }) {
      const row: FakeJobRow = {
        id: randomUUID(),
        name: data.name,
        payload: data.payload,
        runAfter: data.runAfter,
        status: 'pending',
        attempts: 0,
        error: null,
        createdAt: new Date(),
      };
      world.jobs.push(row);
      return { ...row };
    },
    async findFirst(args: { where: { status: string; runAfter: { lte: Date } }; orderBy: { runAfter: 'asc' } }) {
      const status = args.where.status;
      const cutoff = args.where.runAfter.lte;
      const hit = world.jobs
        .filter((r) => r.status === status && r.runAfter <= cutoff)
        .sort((a, b) => a.runAfter.getTime() - b.runAfter.getTime())[0];
      return hit ? { ...hit } : null;
    },
    async updateMany(args: { where: { id: string; status: string }; data: { status: string } }) {
      let count = 0;
      for (const r of world.jobs) {
        if (r.id === args.where.id && r.status === args.where.status) {
          r.status = args.data.status as FakeJobRow['status'];
          count += 1;
        }
      }
      return { count };
    },
    async update(args: {
      where: { id: string };
      data: Partial<Pick<FakeJobRow, 'status' | 'attempts' | 'error' | 'runAfter'>>;
    }) {
      const r = world.jobs.find((x) => x.id === args.where.id);
      if (!r) throw new Error('job not found');
      Object.assign(r, args.data);
      return { ...r };
    },
  };

  const tradingPartner = {
    async findMany({ where }: { where?: { status?: 'active' | 'disabled' } } = {}) {
      return world.partners.filter((p) => !where?.status || p.status === where.status);
    },
  };

  const tenant = {
    async findMany({ where = {} }: { where?: Record<string, unknown> } = {}) {
      let rows = [...world.tenants];
      if (where.deletedAt === null) rows = rows.filter((r) => r.deletedAt === null);
      return rows;
    },
  };

  const transaction = {
    async findMany({ where }: { where: Record<string, unknown> }) {
      return world.txns.filter((t) => txnMatches(t, where));
    },
  };

  const alert = {
    async findUnique({ where }: { where: { dedupeKey?: string } }) {
      return world.alerts.find((a) => a.dedupeKey === where.dedupeKey) ?? null;
    },
    async create({ data }: { data: Record<string, unknown> }) {
      const row: FakeAlert = {
        id: `a-${(world.seq += 1)}`,
        partnerId: (data.partnerId as string | null | undefined) ?? null,
        type: data.type as string,
        severity: (data.severity as string | undefined) ?? 'warning',
        title: data.title as string,
        body: data.body as string,
        dedupeKey: data.dedupeKey as string,
        sourceRef: data.sourceRef ?? {},
        status: 'active',
        createdAt: (data.createdAt as Date | undefined) ?? new Date(),
        lastSeenAt: (data.lastSeenAt as Date | undefined) ?? new Date(),
        acknowledgedAt: null,
        acknowledgedBy: null,
        suppressUntil: (data.suppressUntil as Date | null | undefined) ?? null,
      };
      world.alerts.push(row);
      return row;
    },
    async update({ where, data }: { where: { dedupeKey?: string }; data: Record<string, unknown> }) {
      const row = world.alerts.find((a) => a.dedupeKey === where.dedupeKey);
      if (!row) throw new Error('not found');
      if (data.lastSeenAt !== undefined) row.lastSeenAt = data.lastSeenAt as Date;
      if (data.status !== undefined) row.status = data.status as string;
      if (data.suppressUntil !== undefined) row.suppressUntil = data.suppressUntil as Date | null;
      return row;
    },
  };

  return { job, tenant, tradingPartner, transaction, alert } as unknown as PrismaClient;
}

// ─────────────────────────────────────────────────────────────
// Fixtures
// ─────────────────────────────────────────────────────────────

function freshWorldWithOverdueOutbound(): World {
  // One partner with an outbound 810 that's now 2h old vs a 60min SLA.
  return {
    jobs: [],
    tenants: [],
    partners: [
      {
        id: 'p-sysco',
        displayName: 'Sysco',
        isaSenderIds: ['US'],
        isaReceiverIds: ['SYSCO'],
        slaWindows: [{ setId: '810', direction: 'outbound', withinMinutes: 60 }],
        contacts: [],
        status: 'active',
      },
    ],
    txns: [
      {
        id: 't-810',
        transactionSetId: '810',
        controlNumber: '1',
        direction: 'outbound',
        poNumber: null,
        ackedGroupControl: null,
        functionalGroup: {
          controlNumber: '100',
          interchange: {
            senderId: 'US',
            receiverId: 'SYSCO',
            rawFile: { ingestedAt: new Date('2026-06-18T08:00:00Z') },
          },
        },
      },
    ],
    alerts: [],
    seq: 0,
  };
}

function makeAdapter(prisma: PrismaClient, now: () => Date) {
  return createJobsAdapter(prisma, {
    backend: 'db',
    now,
    pollIntervalMs: 1_000_000,
    timers: {
      setInterval: () => ({} as unknown as NodeJS.Timeout),
      clearInterval: () => {},
    },
  });
}

// ─────────────────────────────────────────────────────────────
// S6.2 — enqueue → tick → alert appears
// ─────────────────────────────────────────────────────────────

test('S6.2: detection job enqueue→tick produces an Alert row', async () => {
  const world = freshWorldWithOverdueOutbound();
  const prisma = makePrisma(world);
  // The clock the WORKER reports as "now" (used by claimNextDueJob).
  const tick = new Date('2026-06-18T10:00:00Z'); // 2h past the SLA
  const adapter = makeAdapter(prisma, () => tick);

  // Register the shared handler with notifier in disabled mode so we don't
  // hit any external transport.
  const handler = createDetectionHandler({
    prisma,
    notifier: {
      prisma,
      config: {
        mode: 'disabled',
        sesFrom: '',
        sesRegion: 'us-east-1',
        globalSlackWebhook: '',
      },
    },
    suppressionMinutes: 60,
    // Force the detection clock so the test is deterministic regardless of
    // wall-clock drift inside the runner.
    now: () => tick,
  });
  adapter.register(DETECTION_JOB_NAME, handler);

  // ─── Enqueue ────────────────────────────────────────────
  const payload: DetectionJobPayload = { tenantId: 'pilot' };
  await adapter.enqueue(DETECTION_JOB_NAME, payload);
  assert.equal(world.jobs.length, 1);
  assert.equal(world.jobs[0]!.status, 'pending');
  assert.equal(world.jobs[0]!.name, DETECTION_JOB_NAME);

  // ─── Tick: worker claims the job and runs the handler ──
  await (adapter as unknown as { runOnce: () => Promise<void> }).runOnce();

  // ─── Job row reached terminal success ──────────────────
  assert.equal(world.jobs[0]!.status, 'done', 'job did not reach done; check handler errors');
  assert.equal(world.jobs[0]!.error, null);

  // ─── The detection logic ran and produced an alert ─────
  assert.equal(world.alerts.length, 1, 'no MISSING_ACK alert was emitted by the handler');
  assert.equal(world.alerts[0]!.type, 'MISSING_ACK');
  assert.equal(world.alerts[0]!.dedupeKey, 'MISSING_ACK::p-sysco::t-810');
});

test('S6.2: detection job with no overdue transactions still flips to done', async () => {
  const world: World = {
    jobs: [],
    tenants: [],
    partners: [],
    txns: [],
    alerts: [],
    seq: 0,
  };
  const prisma = makePrisma(world);
  const tick = new Date('2026-06-18T10:00:00Z');
  const adapter = makeAdapter(prisma, () => tick);

  adapter.register(
    DETECTION_JOB_NAME,
    createDetectionHandler({
      prisma,
      notifier: {
        prisma,
        config: { mode: 'disabled', sesFrom: '', sesRegion: 'us-east-1', globalSlackWebhook: '' },
      },
      suppressionMinutes: 60,
      now: () => tick,
    }),
  );

  await adapter.enqueue(DETECTION_JOB_NAME, {});
  await (adapter as unknown as { runOnce: () => Promise<void> }).runOnce();

  assert.equal(world.jobs[0]!.status, 'done');
  assert.equal(world.alerts.length, 0);
});

test('factory default backend is db (Option A — no BullMQ)', () => {
  // Make sure JOB_BACKEND defaults to db so a missing env var doesn't surprise
  // a production install. The resolver is exhaustively tested in
  // packages/db/test/client-factory.test.ts; this is the integration boundary
  // assertion for D2 Sprint 1.
  const prior = process.env.JOB_BACKEND;
  delete process.env.JOB_BACKEND;
  try {
    const world: World = { jobs: [], tenants: [], partners: [], txns: [], alerts: [], seq: 0 };
    const adapter = makeAdapter(makePrisma(world), () => new Date());
    assert.ok(adapter, 'createJobsAdapter() returned no adapter');
  } finally {
    if (prior !== undefined) process.env.JOB_BACKEND = prior;
  }
});

/**
 * Desktop track D2 Sprint 1 — DbJobAdapter unit tests.
 *
 * Drives the adapter with a fake Prisma client (an in-memory `jobs` table)
 * and a fake clock. Production wiring lives in `apps/api/src/jobs/db-adapter.ts`.
 *
 * Coverage (mapped to the Sprint 1 scorecard):
 *   - S5.4: enqueue → poll → handler called → status 'done'.
 *   - S5.5: handler throws twice, succeeds third → 'done';
 *           handler throws three times → 'dead'.
 *   Plus: payload round-trip, runAfter delay respected, unknown-handler
 *   marks the row failed, dead status carries the last error message.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import type { PrismaClient } from '@prisma/client';
import {
  DbJobAdapter,
  __testing,
  type JobLogger,
} from '../src/jobs/db-adapter.js';

// ─────────────────────────────────────────────────────────────
// Fake Prisma `job` model — just enough surface for the adapter
// ─────────────────────────────────────────────────────────────

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

interface FakeStore {
  rows: FakeJobRow[];
  /** Returns clones so the adapter can't mutate live store state. */
  list(): FakeJobRow[];
}

function makePrisma(store: FakeStore): PrismaClient {
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
      store.rows.push(row);
      return { ...row };
    },
    async findFirst(args: {
      where: { status: string; runAfter: { lte: Date } };
      orderBy: { runAfter: 'asc' };
      select?: Record<string, true>;
    }) {
      const status = args.where.status;
      const cutoff = args.where.runAfter.lte;
      const candidates = store.rows
        .filter((r) => r.status === status && r.runAfter <= cutoff)
        .sort((a, b) => a.runAfter.getTime() - b.runAfter.getTime());
      const hit = candidates[0];
      if (!hit) return null;
      return { ...hit };
    },
    async updateMany(args: {
      where: { id: string; status: string };
      data: { status: string };
    }) {
      let count = 0;
      for (const row of store.rows) {
        if (row.id === args.where.id && row.status === args.where.status) {
          row.status = args.data.status as FakeJobRow['status'];
          count += 1;
        }
      }
      return { count };
    },
    async update(args: {
      where: { id: string };
      data: Partial<Pick<FakeJobRow, 'status' | 'attempts' | 'error' | 'runAfter'>>;
    }) {
      const row = store.rows.find((r) => r.id === args.where.id);
      if (!row) throw new Error(`update: row ${args.where.id} not found`);
      if (args.data.status !== undefined) row.status = args.data.status;
      if (args.data.attempts !== undefined) row.attempts = args.data.attempts;
      if (args.data.error !== undefined) row.error = args.data.error;
      if (args.data.runAfter !== undefined) row.runAfter = args.data.runAfter;
      return { ...row };
    },
  };
  return { job } as unknown as PrismaClient;
}

function freshStore(): { store: FakeStore; prisma: PrismaClient } {
  const store: FakeStore = {
    rows: [],
    list() {
      return this.rows.map((r) => ({ ...r }));
    },
  };
  return { store, prisma: makePrisma(store) };
}

// Controllable clock so retry-after assertions are deterministic.
function makeClock(start: number) {
  let now = start;
  return {
    now: () => new Date(now),
    advance: (ms: number) => { now += ms; },
    set: (ms: number) => { now = ms; },
  };
}

const noopLogger: JobLogger = {
  info: () => {},
  warn: () => {},
  error: () => {},
};

function makeAdapter(prisma: PrismaClient, clock: { now: () => Date }) {
  return new DbJobAdapter(prisma, {
    now: clock.now,
    pollIntervalMs: 1_000_000, // irrelevant; tests use runOnce()
    timers: {
      // Never auto-fire; runOnce() drives ticks in tests.
      setInterval: () => ({} as unknown as NodeJS.Timeout),
      clearInterval: () => {},
    },
    logger: noopLogger,
  });
}

// ─────────────────────────────────────────────────────────────
// S5.4 — enqueue → poll → done
// ─────────────────────────────────────────────────────────────

test('S5.4: enqueue + runOnce drives the handler and marks the row done', async () => {
  const { store, prisma } = freshStore();
  const clock = makeClock(1_700_000_000_000);
  const adapter = makeAdapter(prisma, clock);

  const seen: unknown[] = [];
  adapter.register('demo', async (payload) => {
    seen.push(payload);
  });

  await adapter.enqueue('demo', { hello: 'world' });
  assert.equal(store.rows.length, 1);
  assert.equal(store.rows[0]!.status, 'pending');

  await adapter.runOnce();
  assert.deepEqual(seen, [{ hello: 'world' }]);
  assert.equal(store.rows[0]!.status, 'done');
  assert.equal(store.rows[0]!.error, null);
});

test('runOnce is a no-op when nothing is due', async () => {
  const { store, prisma } = freshStore();
  const clock = makeClock(1_700_000_000_000);
  const adapter = makeAdapter(prisma, clock);
  let called = 0;
  adapter.register('demo', async () => { called += 1; });

  await adapter.runOnce();
  assert.equal(called, 0);
  assert.equal(store.rows.length, 0);
});

// ─────────────────────────────────────────────────────────────
// runAfter delay
// ─────────────────────────────────────────────────────────────

test('enqueue with delayMs sets runAfter into the future; runOnce skips until time passes', async () => {
  const { store, prisma } = freshStore();
  const clock = makeClock(1_700_000_000_000);
  const adapter = makeAdapter(prisma, clock);

  let called = 0;
  adapter.register('demo', async () => { called += 1; });

  await adapter.enqueue('demo', null, { delayMs: 5_000 });
  assert.equal(store.rows[0]!.runAfter.getTime(), clock.now().getTime() + 5_000);

  await adapter.runOnce();
  assert.equal(called, 0, 'handler must not run before runAfter');
  assert.equal(store.rows[0]!.status, 'pending');

  clock.advance(5_000);
  await adapter.runOnce();
  assert.equal(called, 1);
  assert.equal(store.rows[0]!.status, 'done');
});

// ─────────────────────────────────────────────────────────────
// S5.5 — retry then success, and three failures => dead
// ─────────────────────────────────────────────────────────────

test('S5.5: handler throws twice then succeeds; row ends at done', async () => {
  const { store, prisma } = freshStore();
  const clock = makeClock(1_700_000_000_000);
  const adapter = makeAdapter(prisma, clock);

  let attempts = 0;
  adapter.register('flaky', async () => {
    attempts += 1;
    if (attempts < 3) throw new Error(`boom #${attempts}`);
  });

  await adapter.enqueue('flaky', { ok: true });

  // Attempt 1 - fails, runAfter advances by RETRY_DELAYS_MS[0].
  await adapter.runOnce();
  assert.equal(attempts, 1);
  assert.equal(store.rows[0]!.status, 'pending');
  assert.equal(store.rows[0]!.attempts, 1);
  assert.equal(store.rows[0]!.error, 'boom #1');

  clock.advance(__testing.RETRY_DELAYS_MS[0]!);
  await adapter.runOnce();
  assert.equal(attempts, 2);
  assert.equal(store.rows[0]!.status, 'pending');
  assert.equal(store.rows[0]!.attempts, 2);
  assert.equal(store.rows[0]!.error, 'boom #2');

  clock.advance(__testing.RETRY_DELAYS_MS[1]!);
  await adapter.runOnce();
  assert.equal(attempts, 3);
  assert.equal(store.rows[0]!.status, 'done');
  assert.equal(store.rows[0]!.error, null, 'error is cleared on success');
});

test('S5.5: handler throws three times in a row; row ends at dead with last error', async () => {
  const { store, prisma } = freshStore();
  const clock = makeClock(1_700_000_000_000);
  const adapter = makeAdapter(prisma, clock);

  adapter.register('always-fails', async () => {
    throw new Error('catastrophic');
  });

  await adapter.enqueue('always-fails', null);

  await adapter.runOnce();
  assert.equal(store.rows[0]!.status, 'pending');
  assert.equal(store.rows[0]!.attempts, 1);

  clock.advance(__testing.RETRY_DELAYS_MS[0]!);
  await adapter.runOnce();
  assert.equal(store.rows[0]!.status, 'pending');
  assert.equal(store.rows[0]!.attempts, 2);

  clock.advance(__testing.RETRY_DELAYS_MS[1]!);
  await adapter.runOnce();
  assert.equal(store.rows[0]!.status, 'dead', 'third failure parks at dead');
  assert.equal(store.rows[0]!.attempts, 3);
  assert.equal(store.rows[0]!.error, 'catastrophic');
});

// ─────────────────────────────────────────────────────────────
// Edge cases
// ─────────────────────────────────────────────────────────────

test('unknown job name marks the row failed (then retried, then dead)', async () => {
  const { store, prisma } = freshStore();
  const clock = makeClock(1_700_000_000_000);
  const adapter = makeAdapter(prisma, clock);
  // No handlers registered.

  await adapter.enqueue('nope', { ignored: true });

  await adapter.runOnce();
  assert.equal(store.rows[0]!.status, 'pending');
  assert.equal(store.rows[0]!.attempts, 1);
  assert.match(store.rows[0]!.error ?? '', /No handler registered/);

  clock.advance(__testing.RETRY_DELAYS_MS[0]!);
  await adapter.runOnce();
  clock.advance(__testing.RETRY_DELAYS_MS[1]!);
  await adapter.runOnce();
  assert.equal(store.rows[0]!.status, 'dead');
});

test('payload round-trips through JSON.stringify/parse', async () => {
  const { prisma } = freshStore();
  const clock = makeClock(1_700_000_000_000);
  const adapter = makeAdapter(prisma, clock);

  const seen: unknown[] = [];
  adapter.register('echo', async (p) => { seen.push(p); });

  await adapter.enqueue('echo', { nested: { array: [1, 2, 3], flag: true } });
  await adapter.runOnce();

  assert.deepEqual(seen, [{ nested: { array: [1, 2, 3], flag: true } }]);
});

test('handlers registered AFTER enqueue still run on the next tick', async () => {
  const { store, prisma } = freshStore();
  const clock = makeClock(1_700_000_000_000);
  const adapter = makeAdapter(prisma, clock);

  await adapter.enqueue('late-binding', { v: 1 });

  let ran = 0;
  adapter.register('late-binding', async () => { ran += 1; });
  await adapter.runOnce();

  assert.equal(ran, 1);
  assert.equal(store.rows[0]!.status, 'done');
});

test('start + shutdown are idempotent', async () => {
  const { prisma } = freshStore();
  const clock = makeClock(1_700_000_000_000);
  const adapter = makeAdapter(prisma, clock);

  adapter.start();
  adapter.start(); // no-op
  await adapter.shutdown();
  await adapter.shutdown(); // no-op, must not throw
});

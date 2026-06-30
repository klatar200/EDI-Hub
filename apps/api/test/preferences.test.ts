/**
 * PS-10 — preferences API tests.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import Fastify from 'fastify';
import { preferencesRoutes } from '../src/routes/preferences.js';

function makeApp(user: { id: string; preferences: unknown } | null) {
  const app = Fastify();
  app.decorate('prisma', {
    user: {
      findUnique: async () => user,
      update: async ({ data }: { data: { preferences: unknown } }) => ({
        preferences: data.preferences,
      }),
    },
  } as never);
  app.addHook('onRequest', async (request) => {
    request.auth = user
      ? {
          userId: user.id,
          clerkUserId: 'clerk-1',
          role: 'viewer' as const,
          tenantId: '00000000-0000-0000-0000-000000000001',
        }
      : null;
    request.tenantId = '00000000-0000-0000-0000-000000000001';
  });
  return app;
}

test('GET /preferences returns saved views and pins', async () => {
  const app = makeApp({
    id: 'u-1',
    preferences: {
      savedViews: [{ id: 'v1', name: 'Alerts', query: 'hasAlerts=true' }],
      pinnedPos: ['PO-100'],
    },
  });
  await app.register(preferencesRoutes, { prefix: '/api' });
  const res = await app.inject({ method: 'GET', url: '/api/preferences' });
  assert.equal(res.statusCode, 200);
  const body = res.json() as { preferences: { savedViews: unknown[]; pinnedPos: string[] } };
  assert.equal(body.preferences.savedViews.length, 1);
  assert.deepEqual(body.preferences.pinnedPos, ['PO-100']);
  await app.close();
});

test('PATCH /preferences persists pins', async () => {
  const app = makeApp({ id: 'u-1', preferences: {} });
  await app.register(preferencesRoutes, { prefix: '/api' });
  const res = await app.inject({
    method: 'PATCH',
    url: '/api/preferences',
    payload: { pinnedPos: ['PO-200', 'PO-100'] },
  });
  assert.equal(res.statusCode, 200);
  const body = res.json() as { preferences: { pinnedPos: string[] } };
  assert.deepEqual(body.preferences.pinnedPos, ['PO-200', 'PO-100']);
  await app.close();
});

test('PATCH /preferences persists defaultLanding alongside pins', async () => {
  const app = makeApp({ id: 'u-1', preferences: {} });
  await app.register(preferencesRoutes, { prefix: '/api' });
  const res = await app.inject({
    method: 'PATCH',
    url: '/api/preferences',
    payload: { defaultLanding: 'lifecycles', pinnedPos: ['PO-1'] },
  });
  assert.equal(res.statusCode, 200);
  const body = res.json() as { preferences: { defaultLanding?: string; pinnedPos: string[] } };
  assert.equal(body.preferences.defaultLanding, 'lifecycles');
  assert.deepEqual(body.preferences.pinnedPos, ['PO-1']);
  await app.close();
});

test('preferences PATCH persists tablePrefs', async () => {
  const app = makeApp({ id: 'u-1', preferences: {} });
  await app.register(preferencesRoutes, { prefix: '/api' });
  const res = await app.inject({
    method: 'PATCH',
    url: '/api/preferences',
    payload: {
      tablePrefs: {
        lifecycles: { density: 'compact', hiddenColumns: ['flow', 'due'] },
        transactions: { density: 'comfortable', hiddenColumns: ['sender'] },
      },
    },
  });
  assert.equal(res.statusCode, 200);
  const body = res.json() as { preferences: { tablePrefs?: { lifecycles?: { density?: string; hiddenColumns?: string[] } } } };
  assert.equal(body.preferences.tablePrefs?.lifecycles?.density, 'compact');
  assert.deepEqual(body.preferences.tablePrefs?.lifecycles?.hiddenColumns, ['flow', 'due']);
  await app.close();
});

test('PATCH /preferences ignores an invalid defaultLanding', async () => {
  const app = makeApp({ id: 'u-1', preferences: {} });
  await app.register(preferencesRoutes, { prefix: '/api' });
  const res = await app.inject({
    method: 'PATCH',
    url: '/api/preferences',
    payload: { defaultLanding: 'bogus' },
  });
  assert.equal(res.statusCode, 200);
  const body = res.json() as { preferences: { defaultLanding?: string } };
  assert.equal(body.preferences.defaultLanding, undefined);
  await app.close();
});

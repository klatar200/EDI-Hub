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

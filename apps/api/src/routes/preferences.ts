/**
 * PS-10 — User preferences (saved views, pinned POs).
 */
import type { FastifyInstance, FastifyPluginOptions } from 'fastify';
import { randomUUID } from 'node:crypto';
import type { ApiErrorResponse, UserPreferences, UserPreferencesResponse } from '@edi/shared';
import { requiresRole } from '../plugins/rbac.js';

const MAX_PINS = 10;
const MAX_SAVED_VIEWS = 20;

function parsePreferences(raw: unknown): UserPreferences {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return {};
  const o = raw as Record<string, unknown>;
  const prefs: UserPreferences = {};
  if (Array.isArray(o.savedViews)) {
    prefs.savedViews = o.savedViews
      .filter((v): v is Record<string, unknown> => typeof v === 'object' && v !== null)
      .map((v) => ({
        id: String(v.id ?? randomUUID()),
        name: String(v.name ?? 'View'),
        query: String(v.query ?? ''),
      }))
      .filter((v) => v.name.length > 0)
      .slice(0, MAX_SAVED_VIEWS);
  }
  if (Array.isArray(o.pinnedPos)) {
    prefs.pinnedPos = o.pinnedPos
      .filter((p): p is string => typeof p === 'string' && p.trim().length > 0)
      .map((p) => p.trim())
      .slice(0, MAX_PINS);
  }
  if (o.defaultLanding === 'dashboard' || o.defaultLanding === 'lifecycles') {
    prefs.defaultLanding = o.defaultLanding;
  }
  return prefs;
}

export async function preferencesRoutes(
  app: FastifyInstance,
  _opts: FastifyPluginOptions,
): Promise<void> {
  app.get('/preferences', requiresRole('viewer'), async (request, reply) => {
    const userId = request.auth?.userId;
    if (!userId) {
      const body: ApiErrorResponse = { error: { code: 'UNAUTHORIZED', message: 'Sign in required.' } };
      return reply.code(401).send(body);
    }
    const user = await app.prisma.user.findUnique({
      where: { id: userId },
      select: { preferences: true },
    });
    const response: UserPreferencesResponse = {
      preferences: parsePreferences(user?.preferences),
    };
    return reply.send(response);
  });

  app.patch('/preferences', requiresRole('viewer'), async (request, reply) => {
    const userId = request.auth?.userId;
    if (!userId) {
      const body: ApiErrorResponse = { error: { code: 'UNAUTHORIZED', message: 'Sign in required.' } };
      return reply.code(401).send(body);
    }
    const prefs = parsePreferences(request.body);
    const updated = await app.prisma.user.update({
      where: { id: userId },
      data: { preferences: prefs as never },
      select: { preferences: true },
    });
    const response: UserPreferencesResponse = {
      preferences: parsePreferences(updated.preferences),
    };
    return reply.send(response);
  });
}

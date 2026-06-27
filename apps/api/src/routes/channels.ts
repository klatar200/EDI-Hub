/**
 * PS-7 — GET /channels — channel health for ops UI.
 */
import type { FastifyInstance, FastifyPluginOptions } from 'fastify';
import type { ChannelHealthRecord, ChannelsResponse } from '@edi/shared';
import { requiresRole } from '../plugins/rbac.js';

export async function channelsRoutes(
  app: FastifyInstance,
  _opts: FastifyPluginOptions,
): Promise<void> {
  app.get('/channels', requiresRole('viewer'), async (_request, reply) => {
    const raw = app.channels?.health() ?? [];
    const channels: ChannelHealthRecord[] = raw.map((c) => ({
      name: c.name,
      source: c.source,
      status: c.status,
      error: c.error,
      detail: c.detail,
    }));
    const body: ChannelsResponse = { channels };
    return reply.send(body);
  });
}

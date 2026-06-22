/**
 * GET /partners — distinct trading-partner IDs (ISA sender/receiver) seen
 * across ingested interchanges. Powers the UI partner filter.
 */
import type { FastifyInstance, FastifyPluginOptions } from 'fastify';
import type { PartnersResponse } from '@edi/shared';

import { requiresRole } from '../plugins/rbac.js';
export async function partnerRoutes(app: FastifyInstance, _opts: FastifyPluginOptions): Promise<void> {
  app.get('/partners', requiresRole('viewer'), async (_request, reply) => {
    const rows = (await app.prisma.interchange.findMany({})) as Array<{ senderId: string; receiverId: string }>;
    const set = new Set<string>();
    for (const r of rows) {
      if (r.senderId) set.add(r.senderId);
      if (r.receiverId) set.add(r.receiverId);
    }
    const body: PartnersResponse = { partners: [...set].sort() };
    return reply.code(200).send(body);
  });
}

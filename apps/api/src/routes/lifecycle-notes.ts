/**
 * PS-9 — CRUD for lifecycle ops notes on a PO conversation.
 */
import type { FastifyInstance, FastifyPluginOptions } from 'fastify';
import type {
  ApiErrorResponse,
  LifecycleNoteInput,
  LifecycleNoteListResponse,
  LifecycleNoteRecord,
} from '@edi/shared';
import { requiresRole } from '../plugins/rbac.js';
import { withAudit } from '../services/audit.js';

const MAX_NOTE_BODY_CHARS = 4_096;

interface NoteRow {
  id: string;
  po: string;
  body: string;
  authorId: string | null;
  createdAt: Date;
  updatedAt: Date;
  author?: { displayName: string | null } | null;
}

function toDto(row: NoteRow): LifecycleNoteRecord {
  return {
    id: row.id,
    po: row.po,
    body: row.body,
    authorId: row.authorId,
    authorDisplayName: row.author?.displayName ?? null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export async function lifecycleNotesRoutes(
  app: FastifyInstance,
  _opts: FastifyPluginOptions,
): Promise<void> {
  app.get<{ Params: { po: string } }>(
    '/lifecycles/:po/notes',
    requiresRole('viewer'),
    async (request, reply) => {
      const po = decodeURIComponent(request.params.po);
      const rows = (await app.prisma.lifecycleNote.findMany({
        where: { po },
        orderBy: { createdAt: 'asc' },
        include: { author: { select: { displayName: true } } },
      })) as unknown as NoteRow[];
      const body: LifecycleNoteListResponse = { items: rows.map(toDto) };
      return reply.send(body);
    },
  );

  app.post<{ Params: { po: string }; Body: LifecycleNoteInput }>(
    '/lifecycles/:po/notes',
    requiresRole('ops'),
    async (request, reply) => {
      const po = decodeURIComponent(request.params.po);
      const bodyText = typeof request.body?.body === 'string' ? request.body.body.trim() : '';
      if (!bodyText) {
        const body: ApiErrorResponse = { error: { code: 'BAD_REQUEST', message: 'Note body is required.' } };
        return reply.code(400).send(body);
      }
      if (bodyText.length > MAX_NOTE_BODY_CHARS) {
        const body: ApiErrorResponse = {
          error: {
            code: 'BAD_REQUEST',
            message: `Note body must be at most ${MAX_NOTE_BODY_CHARS} characters.`,
          },
        };
        return reply.code(400).send(body);
      }
      const created = await withAudit(
        app.prisma,
        {
          action: 'tenant.config-update',
          targetType: 'tenant',
          actorId: request.auth?.userId ?? null,
        },
        (tx) =>
          tx.lifecycleNote.create({
            data: {
              po,
              body: bodyText,
              authorId: request.auth?.userId ?? null,
            } as never,
            include: { author: { select: { displayName: true } } },
          }),
        (row) => ({ targetId: row.id, after: { po, body: bodyText } }),
      ) as unknown as NoteRow;
      return reply.code(201).send(toDto(created));
    },
  );

  app.delete<{ Params: { po: string; id: string } }>(
    '/lifecycles/:po/notes/:id',
    requiresRole('ops'),
    async (request, reply) => {
      const po = decodeURIComponent(request.params.po);
      const { id } = request.params;
      try {
        await withAudit(
          app.prisma,
          {
            action: 'tenant.config-update',
            targetType: 'tenant',
            actorId: request.auth?.userId ?? null,
          },
          async (tx) => {
            const existing = await tx.lifecycleNote.findFirst({ where: { id, po } });
            if (!existing) throw Object.assign(new Error('not found'), { code: 'P2025' });
            await tx.lifecycleNote.delete({ where: { id } });
            return existing;
          },
          (row) => ({ targetId: row.id, before: row }),
        );
      } catch (e) {
        if (e && typeof e === 'object' && 'code' in e && (e as { code: string }).code === 'P2025') {
          const body: ApiErrorResponse = { error: { code: 'NOT_FOUND', message: 'Note not found.' } };
          return reply.code(404).send(body);
        }
        throw e;
      }
      return reply.code(204).send();
    },
  );
}

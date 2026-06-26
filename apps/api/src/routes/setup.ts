/**
 * Desktop track D8 Sprint 2 — first-run wizard API.
 *
 *   GET   /setup           wizard state for the current tenant
 *   PATCH /setup           partial hub config updates (admin)
 *   POST  /setup/verify-auth  Clerk round-trip check (admin)
 */
import type { FastifyInstance, FastifyPluginOptions } from 'fastify';
import type { ApiErrorResponse, SetupPatchInput, SetupStatusResponse } from '@edi/shared';
import { tenantContext } from '@edi/db';
import { requiresRole } from '../plugins/rbac.js';
import { withAudit } from '../services/audit.js';
import {
  isDesktopHubMode,
  readHubConfig,
  writeHubConfig,
} from '../services/hub-config.js';

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function normalizeIsaIds(raw: unknown): string[] | undefined {
  if (!Array.isArray(raw)) return undefined;
  const ids = raw
    .filter((v): v is string => typeof v === 'string')
    .map((v) => v.trim())
    .filter((v) => v.length > 0);
  return ids.length > 0 ? ids : [];
}

function readPatch(body: unknown): SetupPatchInput {
  if (!isObject(body)) throw new Error('Request body must be an object.');
  const patch: SetupPatchInput = {};
  if (typeof body.dropFolderPath === 'string') {
    const trimmed = body.dropFolderPath.trim();
    if (trimmed.length > 0) patch.dropFolderPath = trimmed;
  }
  if (typeof body.telemetryEnabled === 'boolean') patch.telemetryEnabled = body.telemetryEnabled;
  if (typeof body.clerkRedirectVerified === 'boolean') {
    patch.clerkRedirectVerified = body.clerkRedirectVerified;
  }
  if (typeof body.firstRunComplete === 'boolean') patch.firstRunComplete = body.firstRunComplete;
  const ourIsaIds = normalizeIsaIds(body.ourIsaIds);
  if (ourIsaIds !== undefined) patch.ourIsaIds = ourIsaIds;
  return patch;
}

async function readOurIsaIds(
  app: FastifyInstance,
  tenantId: string | undefined,
): Promise<string[]> {
  if (!tenantId) return [];
  const tenant = await app.prisma.tenant.findUnique({
    where: { id: tenantId },
    select: { ourIsaIds: true },
  });
  return tenant?.ourIsaIds ?? [];
}

async function buildStatus(
  app: FastifyInstance,
  tenantId: string | undefined,
): Promise<SetupStatusResponse> {
  const desktopMode = isDesktopHubMode();
  const cfg = desktopMode ? readHubConfig() : {};
  const ourIsaIds = await readOurIsaIds(app, tenantId);

  let hasIngested = false;
  if (tenantId) {
    const count = await app.prisma.rawFile.count({ where: { tenantId } });
    hasIngested = count > 0;
  }

  if (!desktopMode) {
    return {
      firstRunComplete: true,
      dropFolderPath: null,
      telemetryEnabled: null,
      hasIngested,
      clerkRedirectVerified: true,
      desktopMode: false,
      ourIsaIds,
    };
  }

  return {
    firstRunComplete: cfg.firstRunComplete === true,
    dropFolderPath: cfg.dropFolderPath ?? null,
    telemetryEnabled:
      typeof cfg.telemetryEnabled === 'boolean' ? cfg.telemetryEnabled : null,
    hasIngested,
    clerkRedirectVerified: cfg.clerkRedirectVerified === true,
    desktopMode: true,
    ourIsaIds,
  };
}

export async function setupRoutes(
  app: FastifyInstance,
  _opts: FastifyPluginOptions,
): Promise<void> {
  app.get('/setup', requiresRole('viewer'), async (request, reply) => {
    const body = await buildStatus(app, request.tenantId);
    return reply.code(200).send(body);
  });

  app.post('/setup/verify-auth', requiresRole('admin'), async (request, reply) => {
    void request;
    if (!isDesktopHubMode()) {
      return reply.code(200).send({ ok: true });
    }
    writeHubConfig({ clerkRedirectVerified: true });
    return reply.code(200).send({ ok: true });
  });

  app.patch('/setup', requiresRole('admin'), async (request, reply) => {
    if (!isDesktopHubMode()) {
      const body: ApiErrorResponse = {
        error: { code: 'NOT_DESKTOP', message: 'Setup is only available in the desktop installer.' },
      };
      return reply.code(400).send(body);
    }

    let patch: SetupPatchInput;
    try {
      patch = readPatch(request.body);
    } catch (err) {
      const body: ApiErrorResponse = {
        error: { code: 'INVALID_BODY', message: (err as Error).message },
      };
      return reply.code(400).send(body);
    }

    const completing = patch.firstRunComplete === true;
    const cfg = writeHubConfig({
      ...patch,
      ...(completing ? { firstRunComplete: true } : {}),
    });

    if (patch.ourIsaIds !== undefined && request.tenantId) {
      const tenantId = tenantContext.requireTenantId();
      const existing = await tenantContext.bypass(async () =>
        app.prisma.tenant.findUnique({
          where: { id: tenantId },
          select: { ourIsaIds: true },
        }),
      );
      await withAudit(
        app.prisma,
        {
          action: 'tenant.config-update',
          targetType: 'tenant',
          actorId: request.auth?.userId ?? null,
        },
        async (tx) =>
          tx.tenant.update({
            where: { id: tenantId },
            data: { ourIsaIds: patch.ourIsaIds },
          }),
        (row) => ({
          targetId: row.id,
          before: { ourIsaIds: existing?.ourIsaIds ?? [] },
          after: { ourIsaIds: row.ourIsaIds },
        }),
      );
    }

    if (completing && cfg.dropFolderPath && app.channels) {
      await app.channels.ensureDesktopDropFolder(cfg.dropFolderPath);
    } else if (patch.dropFolderPath && cfg.firstRunComplete && app.channels) {
      await app.channels.ensureDesktopDropFolder(patch.dropFolderPath);
    }

    const status = await buildStatus(app, request.tenantId);
    return reply.code(200).send(status);
  });
}

/**
 * API entrypoint. Boots the Fastify server, starts every configured
 * ingestion channel through the channel registry, and handles graceful
 * shutdown.
 *
 * Phase 8 Sprint 2 — the channel registry replaces the inline SFTP boot.
 * Adding a new channel is one entry in `startConfiguredChannels`, not a new
 * lifecycle to thread through `main`.
 */
import { buildServer } from './server.js';
import { ensureBucket } from './storage/s3.js';
import { startConfiguredChannels } from './channels/registry.js';
import { disconnectPrisma, tenantContext } from '@edi/db';
import { loadConfig, assertProductionAuthConfig, resolveAuthMode } from './config.js';
import { applySecretsFromManager } from './services/secrets.js';
import { readHubConfig, isDesktopHubMode } from './services/hub-config.js';
import { createJobsAdapter } from './jobs/factory.js';
import {
  createDetectionHandler,
  DETECTION_JOB_NAME,
} from './jobs/handlers/detection.js';
import {
  bootstrapEmailDigestSchedules,
  createEmailDigestHandler,
  EMAIL_DIGEST_JOB_NAME,
  type EmailDigestPayload,
} from './jobs/handlers/email-digest.js';
import { reconcileStuckReceived } from './services/parsing.js';

async function main(): Promise<void> {
  // Phase 9 Sprint 4 — load env config first, then overlay secrets from
  // AWS Secrets Manager when SM_PREFIX is set. In dev the overlay is a
  // no-op (EnvSecretSource just re-reads process.env), so this path is
  // safe to run unconditionally.
  const config = await applySecretsFromManager(loadConfig());
  assertProductionAuthConfig(config);
  const app = await buildServer({ config });
  app.log.info(
    { authMode: resolveAuthMode(config), nodeEnv: config.nodeEnv },
    'Auth mode active',
  );

  // Dev safety net: make sure the bucket exists locally. On AWS this is a
  // no-op (the Terraform-provisioned bucket already exists). Skipped for the
  // local-filesystem backend - D3 Sprint 1.
  if (app.config.storage.backend === 's3') {
    await ensureBucket(app.s3, app.config.s3.bucket);
  }

  const hubCfg = isDesktopHubMode() ? readHubConfig() : {};
  const desktopDropFolder =
    hubCfg.firstRunComplete && hubCfg.dropFolderPath ? hubCfg.dropFolderPath : null;

  const channels = await startConfiguredChannels(
    { s3: app.s3, storage: app.storage, prisma: app.prisma, config: app.config, logger: app.log },
    app.config,
    { desktopDropFolder },
  );
  // Expose the registry to the health route via the Fastify decorator.
  app.decorate('channels', channels);

  // D2 Sprint 1 - boot the in-process job queue + worker.
  // D2 Sprint 2 - register the shared detection handler. The CLI runner
  // (`scripts/run-detection.ts`) calls the same factory, so there's one
  // source of truth for what a detection pass does.
  const jobs = createJobsAdapter(app.prisma, { logger: app.log });
  jobs.register(
    DETECTION_JOB_NAME,
    createDetectionHandler({
      prisma: app.prisma,
      notifier: { prisma: app.prisma, config: app.config.notifier },
      suppressionMinutes: app.config.alertSuppressionMinutes,
      logger: app.log,
    }),
  );
  const digestPreviewMode = app.config.notifier.mode !== 'live';
  const scheduleDigest = async (tenantId: string, hourUtc: number): Promise<void> => {
    const { msUntilDigestHour } = await import('./jobs/email-digest-schedule.js');
    await jobs.enqueue(EMAIL_DIGEST_JOB_NAME, { tenantId }, { delayMs: msUntilDigestHour(hourUtc) });
  };
  jobs.register(
    EMAIL_DIGEST_JOB_NAME,
    createEmailDigestHandler({
      prisma: app.prisma,
      previewMode: digestPreviewMode,
      scheduleNext: scheduleDigest,
    }),
  );
  jobs.start();
  app.decorate('jobs', jobs);

  void bootstrapEmailDigestSchedules(
    app.prisma,
    async (payload: EmailDigestPayload, delayMs: number) => {
      await jobs.enqueue(EMAIL_DIGEST_JOB_NAME, payload, { delayMs });
    },
  ).catch((err) => {
    app.log.warn({ err }, 'Email digest bootstrap failed (non-fatal)');
  });

  // PS-5 — startup reconcile for RECEIVED rows stuck after a crash.
  void tenantContext.bypass(async () => {
    const tenants = await app.prisma.tenant.findMany({ where: { deletedAt: null }, select: { id: true } });
    const deps = { s3: app.s3, storage: app.storage, prisma: app.prisma, config: app.config, logger: app.log };
    for (const tenant of tenants) {
      await tenantContext.run({ tenantId: tenant.id }, async () => {
        const count = await reconcileStuckReceived(deps);
        if (count > 0) {
          app.log.info({ tenantId: tenant.id, count }, 'Startup reconcile: re-parsed stuck RECEIVED raw files');
        }
      });
    }
  }).catch((err) => {
    app.log.warn({ err }, 'Startup reconcile failed (non-fatal)');
  });

  const close = async (signal: string): Promise<void> => {
    app.log.info({ signal }, 'Shutting down');
    await jobs.shutdown();
    await channels.closeAll();
    await app.close();
    await disconnectPrisma();
    process.exit(0);
  };
  process.on('SIGINT', () => void close('SIGINT'));
  process.on('SIGTERM', () => void close('SIGTERM'));

  await app.listen({ port: app.config.port, host: '0.0.0.0' });
}

main().catch((err) => {
  console.error('Fatal startup error:', err);
  process.exit(1);
});

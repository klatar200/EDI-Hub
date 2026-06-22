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
import { disconnectPrisma } from '@edi/db';
import { loadConfig } from './config.js';
import { applySecretsFromManager } from './services/secrets.js';

async function main(): Promise<void> {
  // Phase 9 Sprint 4 — load env config first, then overlay secrets from
  // AWS Secrets Manager when SM_PREFIX is set. In dev the overlay is a
  // no-op (EnvSecretSource just re-reads process.env), so this path is
  // safe to run unconditionally.
  const config = await applySecretsFromManager(loadConfig());
  const app = await buildServer({ config });

  // Dev safety net: make sure the bucket exists locally. On AWS this is a
  // no-op (the Terraform-provisioned bucket already exists).
  await ensureBucket(app.s3, app.config.s3.bucket);

  const channels = await startConfiguredChannels(
    { s3: app.s3, prisma: app.prisma, config: app.config, logger: app.log },
    app.config,
  );
  // Expose the registry to the health route via the Fastify decorator.
  app.decorate('channels', channels);

  const close = async (signal: string): Promise<void> => {
    app.log.info({ signal }, 'Shutting down');
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

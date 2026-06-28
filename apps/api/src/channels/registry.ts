/**
 * Phase 8 Sprint 2 — channel registry.
 *
 * Owns the lifecycle of every configured IngestionChannel: starts each one
 * (catching start-time errors so one bad channel doesn't take the server down),
 * holds the handles for graceful shutdown, and exposes a health snapshot for
 * the /health route.
 *
 * Desktop track D8 Sprint 2 — adds an optional `desktop-drop` channel that is
 * configured from `<userData>/config.json` after the first-run wizard completes.
 */
import type { IngestionDeps } from '../services/ingestion.js';
import type { AppConfig } from '../config.js';
import type { ChannelHealth, IngestionChannel } from './types.js';
import { isDesktopHubMode } from '../services/hub-config.js';
import { startSftpChannel } from '../sftp/watcher.js';
import { startAs2Channel } from './as2.js';
import { DESKTOP_DROP_CHANNEL_NAME, startDesktopDropChannel } from './desktop-drop.js';

export interface ChannelRegistry {
  /** Snapshot of every channel (including disabled / errored ones). */
  health(): ChannelHealth[];
  /** Gracefully shut down all running channels. Safe to call once. */
  closeAll(): Promise<void>;
  /** Desktop track D8 Sprint 2 — start or restart the user-chosen drop folder. */
  ensureDesktopDropFolder(watchDir: string): Promise<void>;
}

interface ChannelEntry {
  health: ChannelHealth;
  channel: IngestionChannel | null;
}

/** SEC-H3 — SFTP/AS2 passive ingest is pinned to the pilot tenant. Disable in
 *  production multi-tenant SaaS until per-tenant channel mapping exists. */
function passiveChannelsAllowed(config: AppConfig): boolean {
  if (config.nodeEnv !== 'production') return true;
  if (isDesktopHubMode()) return true;
  return !config.clerk.secretKey.trim();
}

export async function startConfiguredChannels(
  deps: IngestionDeps,
  config: AppConfig,
  opts: { desktopDropFolder?: string | null } = {},
): Promise<ChannelRegistry> {
  const entries: ChannelEntry[] = [];
  const passiveOk = passiveChannelsAllowed(config);

  if (!passiveOk && (config.sftp.enabled || config.as2.enabled)) {
    deps.logger.warn(
      'SFTP/AS2 passive channels are disabled in production multi-tenant mode (ingest is pinned to pilot tenant)',
    );
  }

  entries.push(
    await startOne({
      enabled: config.sftp.enabled && passiveOk,
      name: 'sftp',
      source: 'sftp',
      detail: { watchDir: config.sftp.watchDir },
      start: () => startSftpChannel(deps, config.sftp),
    }),
  );

  entries.push(
    await startOne({
      enabled: config.as2.enabled && passiveOk,
      name: 'as2',
      source: 'as2',
      detail: { inboxDir: config.as2.inboxDir },
      start: () => startAs2Channel(deps, config.as2),
    }),
  );

  if (opts.desktopDropFolder) {
    entries.push(
      await startOne({
        enabled: true,
        name: DESKTOP_DROP_CHANNEL_NAME,
        source: 'sftp',
        detail: { watchDir: opts.desktopDropFolder },
        start: () => startDesktopDropChannel(deps, opts.desktopDropFolder!),
      }),
    );
  } else {
    entries.push({
      channel: null,
      health: {
        name: DESKTOP_DROP_CHANNEL_NAME,
        source: 'sftp',
        status: 'disabled',
        detail: { watchDir: '' },
      },
    });
  }

  async function ensureDesktopDropFolder(watchDir: string): Promise<void> {
    const idx = entries.findIndex((e) => e.health.name === DESKTOP_DROP_CHANNEL_NAME);
    if (idx < 0) return;

    const existing = entries[idx]!.channel;
    if (existing) {
      await existing.close().catch((err) => {
        deps.logger.error({ err }, 'desktop-drop close failed before restart');
      });
    }

    entries[idx] = await startOne({
      enabled: true,
      name: DESKTOP_DROP_CHANNEL_NAME,
      source: 'sftp',
      detail: { watchDir },
      start: () => startDesktopDropChannel(deps, watchDir),
    });
  }

  return {
    health: () => entries.map((e) => e.health),
    closeAll: async () => {
      for (const e of entries) {
        if (e.channel) {
          await e.channel.close().catch((err) => {
            deps.logger.error({ err, channel: e.health.name }, 'Channel close failed');
          });
        }
      }
    },
    ensureDesktopDropFolder,
  };
}

interface StartOneOptions {
  enabled: boolean;
  name: string;
  source: ChannelHealth['source'];
  detail: Record<string, string>;
  start: () => Promise<IngestionChannel>;
}

async function startOne(opts: StartOneOptions): Promise<ChannelEntry> {
  if (!opts.enabled) {
    return {
      channel: null,
      health: { name: opts.name, source: opts.source, status: 'disabled', detail: opts.detail },
    };
  }
  try {
    const channel = await opts.start();
    return { channel, health: channel.status() };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      channel: null,
      health: {
        name: opts.name,
        source: opts.source,
        status: 'error',
        error: message,
        detail: opts.detail,
      },
    };
  }
}

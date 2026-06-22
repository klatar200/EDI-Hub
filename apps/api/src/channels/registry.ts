/**
 * Phase 8 Sprint 2 — channel registry.
 *
 * Owns the lifecycle of every configured IngestionChannel: starts each one
 * (catching start-time errors so one bad channel doesn't take the server down),
 * holds the handles for graceful shutdown, and exposes a health snapshot for
 * the /health route.
 *
 * Boot semantics:
 *   - If a channel is `enabled: false`, we record it as `disabled` and skip start.
 *   - If `start()` throws, we record the error as `status: 'error'` and continue
 *     booting the rest. The API stays up; the operator sees the failure on /health.
 *   - If `start()` succeeds, we record it as `running` and add it to the
 *     shutdown list.
 *
 * This shape is what makes adding a Phase 8 third channel (and a future fourth)
 * a structural change rather than a rewrite — see BUILD_PLAN §5 Phase 8 goal.
 */
import type { IngestionDeps } from '../services/ingestion.js';
import type { AppConfig } from '../config.js';
import type { ChannelHealth, IngestionChannel } from './types.js';
import { startSftpChannel } from '../sftp/watcher.js';
import { startAs2Channel } from './as2.js';

export interface ChannelRegistry {
  /** Snapshot of every channel (including disabled / errored ones). */
  health(): ChannelHealth[];
  /** Gracefully shut down all running channels. Safe to call once. */
  closeAll(): Promise<void>;
}

interface ChannelEntry {
  health: ChannelHealth;
  channel: IngestionChannel | null;
}

export async function startConfiguredChannels(
  deps: IngestionDeps,
  config: AppConfig,
): Promise<ChannelRegistry> {
  const entries: ChannelEntry[] = [];

  // SFTP — configured since Phase 1.
  entries.push(
    await startOne({
      enabled: config.sftp.enabled,
      name: 'sftp',
      source: 'sftp',
      detail: { watchDir: config.sftp.watchDir },
      start: () => startSftpChannel(deps, config.sftp),
    }),
  );

  // AS2 — added in Phase 8 Sprint 2.
  entries.push(
    await startOne({
      enabled: config.as2.enabled,
      name: 'as2',
      source: 'as2',
      detail: { inboxDir: config.as2.inboxDir },
      start: () => startAs2Channel(deps, config.as2),
    }),
  );

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
    // Use the channel's own status when available — it knows its watchDir, etc.
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

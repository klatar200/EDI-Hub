/**
 * SFTP folder-watch ingestion channel.
 *
 * A local SFTP server (docker-compose) writes dropped EDI files into a shared
 * folder; this watcher picks them up and runs them through the SAME ingestion
 * pipeline as the HTTP endpoint — not a parallel path. Successfully ingested
 * files (including duplicates) move to /processed; anything that errors moves
 * to /failed, so nothing is silently lost and the drop folder stays clean.
 *
 * Phase 8 Sprint 2 — the runtime logic now lives in `channels/drop-folder.ts`,
 * shared with the AS2 channel. This file keeps the original public shape so
 * existing call sites and tests don't churn.
 */
import type { IngestionDeps } from '../services/ingestion.js';
import type { SftpWatchConfig } from '../config.js';
import { startDropFolderChannel } from '../channels/drop-folder.js';
import type { IngestionChannel } from '../channels/types.js';

export interface SftpWatcher {
  /** Resolves once the initial scan has been processed (useful in tests). */
  ready: Promise<void>;
  close: () => Promise<void>;
}

/**
 * Backward-compatible SFTP watcher entrypoint. Internally a thin wrapper around
 * the generic drop-folder channel — see `channels/drop-folder.ts`. New code
 * should prefer `startDropFolderChannel` directly so the IngestionChannel
 * object (with `status()`) is exposed to the channel registry / health route.
 */
export async function startSftpWatcher(
  deps: IngestionDeps,
  config: SftpWatchConfig,
): Promise<SftpWatcher> {
  const channel = await startSftpChannel(deps, config);
  return { ready: channel.ready, close: channel.close };
}

/** Phase 8 Sprint 2 — IngestionChannel-typed variant used by the registry. */
export async function startSftpChannel(
  deps: IngestionDeps,
  config: SftpWatchConfig,
): Promise<IngestionChannel> {
  return startDropFolderChannel(deps, {
    name: 'sftp',
    source: 'sftp',
    watchDir: config.watchDir,
    processedDir: config.processedDir,
    failedDir: config.failedDir,
    stabilityThresholdMs: config.stabilityThresholdMs,
  });
}

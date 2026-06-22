/**
 * Phase 8 Sprint 2 — generic drop-folder channel.
 *
 * Watches a folder for new files, hands the bytes to `ingestRawFile`, then moves
 * the file to a processed/ or failed/ folder so the watch folder stays clean and
 * nothing is silently lost. This is the substrate for every passive channel
 * that gives us a file on disk:
 *
 *   - SFTP: a real SFTP server writes into the watch folder.
 *   - AS2:  OpenAS2 decrypts/verifies the inbound payload and drops the
 *           plaintext EDI file into the watch folder.
 *
 * The shape of the channel is identical in both cases — the only differences
 * are the SourceChannel tag and the configured folders. Each instance is a
 * separate IngestionChannel so the health route can report them independently.
 */
import { mkdir, readFile, rename, copyFile, unlink } from 'node:fs/promises';
import { basename, join } from 'node:path';
import chokidar, { type FSWatcher } from 'chokidar';
import type { SourceChannel } from '@edi/shared';
import { tenantContext, PILOT_TENANT_ID } from '@edi/db';
import type { IngestionDeps } from '../services/ingestion.js';
import { ingestRawFile } from '../services/ingestion.js';
import type { ChannelHealth, IngestionChannel } from './types.js';

export interface DropFolderConfig {
  /** Human-readable channel name (matches SourceChannel when applicable). */
  name: string;
  /** SourceChannel tag stamped on each ingested raw_files row. */
  source: SourceChannel;
  /** Folder watched for incoming files. */
  watchDir: string;
  /** Successful files go here (kept for audit). */
  processedDir: string;
  /** Failed files go here so a human can triage. */
  failedDir: string;
  /** How long a file must be quiescent before we treat the write as complete.
   *  Protects against picking up partially-written drops. */
  stabilityThresholdMs: number;
}

/** Move a file across folders, falling back to copy+unlink across devices. */
async function moveFile(from: string, toDir: string): Promise<void> {
  const dest = join(toDir, basename(from));
  try {
    await rename(from, dest);
  } catch {
    await copyFile(from, dest);
    await unlink(from);
  }
}

export async function startDropFolderChannel(
  deps: IngestionDeps,
  config: DropFolderConfig,
): Promise<IngestionChannel> {
  await Promise.all([
    mkdir(config.watchDir, { recursive: true }),
    mkdir(config.processedDir, { recursive: true }),
    mkdir(config.failedDir, { recursive: true }),
  ]);

  const log = deps.logger.child({ channel: config.name, watchDir: config.watchDir });

  async function handleFile(path: string): Promise<void> {
    // Phase 9 Sprint 1.4 — channel watchers have no request context; pin each
    // file's ingestion to the pilot tenant. Future Phase 11 commercialization
    // work will give each tenant its own SFTP/AS2 endpoint, at which point
    // the tenantId will come from per-channel config rather than this default.
    await tenantContext.run({ tenantId: PILOT_TENANT_ID }, async () => {
      try {
        const content = await readFile(path);
        const result = await ingestRawFile(deps, {
          content,
          source: config.source,
          filename: basename(path),
        });
        if (result.outcome === 'stored' || result.outcome === 'duplicate') {
          await moveFile(path, config.processedDir);
        } else {
          log.error({ path, outcome: result.outcome }, 'Ingestion failed; moving to failed folder');
          await moveFile(path, config.failedDir);
        }
      } catch (err) {
        log.error({ err, path }, 'Unexpected error processing dropped file');
        await moveFile(path, config.failedDir).catch((moveErr) => {
          log.error({ err: moveErr, path }, 'Could not move failed file');
        });
      }
    });
  }

  const watcher: FSWatcher = chokidar.watch(config.watchDir, {
    ignoreInitial: false, // pick up files already sitting in the folder at boot
    awaitWriteFinish: {
      stabilityThreshold: config.stabilityThresholdMs,
      pollInterval: 100,
    },
    depth: 0,
  });

  // Serialize processing so two files don't race on the same pipeline.
  let queue: Promise<void> = Promise.resolve();
  watcher.on('add', (path) => {
    queue = queue.then(() => handleFile(path));
  });
  watcher.on('error', (err) => log.error({ err }, `${config.name} watcher error`));

  const ready = new Promise<void>((resolve) => {
    watcher.on('ready', () => {
      log.info(`${config.name} channel ready`);
      resolve();
    });
  });

  return {
    name: config.name,
    ready,
    status(): ChannelHealth {
      return {
        name: config.name,
        source: config.source,
        status: 'running',
        detail: {
          watchDir: config.watchDir,
          processedDir: config.processedDir,
          failedDir: config.failedDir,
        },
      };
    },
    close: async () => {
      await watcher.close();
      await queue; // let any in-flight file finish
    },
  };
}

/**
 * Phase 8 Sprint 2 — AS2 receive channel.
 *
 * AS2 is structurally identical to SFTP for our purposes: someone writes a
 * file into a folder we watch, and we ingest it. The *what* is different
 * (OpenAS2 decrypts the payload, verifies the signature, and emits the MDN
 * server-side), but the surface we touch is the same. This file is therefore
 * a thin convention layer over `startDropFolderChannel`.
 *
 * Why we don't speak AS2 in-process: AS2 is a mature spec with cert/MDN
 * subtleties (RFC 4130). Reimplementing it would be weeks of work for zero
 * differentiation; OpenAS2 is the de-facto reference daemon and runs as a
 * separate process. Following BUILD_PLAN principle #5 — passive observability
 * over active interception — we delegate the protocol and ingest the bytes.
 *
 * Operational note: the OpenAS2 inbox is configured to drop plaintext EDI
 * files only after the signature + MDN dance has succeeded. By the time we
 * see a file, it's a confirmed legitimate inbound transmission.
 */
import type { IngestionDeps } from '../services/ingestion.js';
import type { As2WatchConfig } from '../config.js';
import { startDropFolderChannel } from './drop-folder.js';
import type { IngestionChannel } from './types.js';

export async function startAs2Channel(
  deps: IngestionDeps,
  config: As2WatchConfig,
): Promise<IngestionChannel> {
  return startDropFolderChannel(deps, {
    name: 'as2',
    source: 'as2',
    watchDir: config.inboxDir,
    processedDir: config.processedDir,
    failedDir: config.failedDir,
    stabilityThresholdMs: config.stabilityThresholdMs,
  });
}

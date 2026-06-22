/**
 * Phase 8 Sprint 2 — Ingestion channel adapter interface.
 *
 * Every passive ingestion source (SFTP folder-watch, AS2 receive, future VAN
 * mailbox poll) implements this shape so the server boot and the health route
 * can treat them uniformly. HTTP upload is not modelled here — it's an inline
 * route handler, not a long-running channel.
 *
 * Channels are *passive*: they receive copies of EDI files and hand them to
 * `ingestRawFile`. They never sit in the live transmission path.
 *
 * Lifecycle:
 *   - `start()` (the factory) returns the channel after its watcher is ready.
 *   - `close()` shuts the underlying watcher down and drains in-flight work.
 *   - `status()` returns a synchronous snapshot the health route can include.
 */
import type { SourceChannel } from '@edi/shared';

/** Channel runtime state surfaced on /health. */
export type ChannelHealthStatus =
  /** Channel is enabled and actively listening (folder watched, port bound). */
  | 'running'
  /** Channel is configured but `enabled=false` — boot skipped it intentionally. */
  | 'disabled'
  /** Channel attempted to start and threw — operator action needed. */
  | 'error';

export interface ChannelHealth {
  name: string;
  /** Matches the SourceChannel enum so the same identifier flows through to the DB. */
  source: SourceChannel;
  status: ChannelHealthStatus;
  /** Set when status === 'error' — the original error message. */
  error?: string;
  /** Per-channel diagnostics (e.g. watchDir, port). Renders verbatim. */
  detail?: Record<string, string>;
}

export interface IngestionChannel {
  /** Stable identifier (matches SourceChannel where applicable). */
  readonly name: string;
  /** Resolves once the channel has finished its initial scan / handshake.
   *  Useful in tests to deterministically wait for first activity. */
  readonly ready: Promise<void>;
  /** Synchronous health snapshot. */
  status(): ChannelHealth;
  /** Drains the channel; safe to call multiple times. */
  close(): Promise<void>;
}

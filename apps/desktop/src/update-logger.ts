/**
 * Dedicated auto-update diagnostic log.
 *
 * Writes to `logs/update-YYYY-MM-DD.log` (separate from the general
 * `edi-hub-*.log`) so update sessions can be shared without wading through
 * Postgres/API noise. Each line is pipe-delimited for quick reading; complex
 * fields are JSON on the right.
 */
import { app } from 'electron';
import { createWriteStream, existsSync, mkdirSync, type WriteStream } from 'node:fs';
import { join } from 'node:path';
import { shouldLogDownloadProgress } from './update-log-throttle.js';

export type UpdateLogEvent =
  | 'session_start'
  | 'session_end'
  | 'startup_gate'
  | 'post_update_skip'
  | 'check_begin'
  | 'check_result'
  | 'update_available'
  | 'update_not_available'
  | 'download_begin'
  | 'download_progress'
  | 'download_complete'
  | 'install_begin'
  | 'install_quit'
  | 'manual_check'
  | 'manual_confirm'
  | 'whats_new'
  | 'boot_phase'
  | 'updater_log'
  | 'error';

let stream: WriteStream | null = null;
let sessionId = '';
let installed = false;

/** Last logged download percent — used to throttle progress lines. */
let lastLoggedDownloadPercent = -1;
let lastDownloadProgressAt = 0;

export function updateLogFilePath(): string {
  const dir = app.getPath('logs');
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  const stamp = new Date().toISOString().slice(0, 10);
  return join(dir, `update-${stamp}.log`);
}

function writeLine(event: UpdateLogEvent, detail?: Record<string, unknown>): void {
  if (!stream) return;
  const detailJson = detail && Object.keys(detail).length > 0 ? JSON.stringify(detail) : '';
  const line = `${new Date().toISOString()} | ${sessionId} | ${event}${detailJson ? ` | ${detailJson}` : ''}\n`;
  stream.write(line);
  console.log(`[update] ${event}${detailJson ? ` ${detailJson}` : ''}`);
}

export function installUpdateLogger(): void {
  if (installed) return;
  installed = true;
  sessionId = `${Date.now()}-${process.pid}`;
  stream = createWriteStream(updateLogFilePath(), { flags: 'a' });
  writeLine('session_start', {
    appVersion: app.getVersion(),
    packaged: app.isPackaged,
    pid: process.pid,
    argv: process.argv,
    userData: app.getPath('userData'),
    logFile: updateLogFilePath(),
  });
}

export function logUpdate(event: UpdateLogEvent, detail?: Record<string, unknown>): void {
  writeLine(event, detail);
}

/** Boot milestones after an update (postgres, api, window). */
export function logBootPhase(phase: string, detail?: Record<string, unknown>): void {
  writeLine('boot_phase', { phase, ...detail });
}

/**
 * Throttle download progress — log at 5% boundaries and at most every 2s
 * so a full installer pull does not produce thousands of lines.
 */
export function logDownloadProgress(detail: {
  version: string;
  percent: number;
  transferred: number;
  total: number;
  bytesPerSecond: number;
  peakPercent: number;
  hint?: string;
}): void {
  const now = Date.now();
  if (!shouldLogDownloadProgress(detail.peakPercent, lastLoggedDownloadPercent, lastDownloadProgressAt, now)) {
    return;
  }
  lastLoggedDownloadPercent = detail.peakPercent;
  lastDownloadProgressAt = now;
  writeLine('download_progress', detail);
}

export function resetDownloadProgressLogging(): void {
  lastLoggedDownloadPercent = -1;
  lastDownloadProgressAt = 0;
}

/** Bridge electron-updater's internal logger into our update log file. */
export function createUpdaterLoggerBridge(): {
  info: (message: string) => void;
  warn: (message: string) => void;
  error: (message: string) => void;
} {
  const bridge = (level: 'info' | 'warn' | 'error', message: string) => {
    writeLine('updater_log', { level, message });
  };
  return {
    info: (message) => bridge('info', message),
    warn: (message) => bridge('warn', message),
    error: (message) => bridge('error', message),
  };
}

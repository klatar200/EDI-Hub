/**
 * Desktop track — file logging to Electron's logs directory.
 *
 * Packaged Windows builds don't surface `console.log` anywhere the user
 * can find it. We tee stdout/stderr into a dated log file under
 * `app.getPath('logs')` so Help → Open Logs Folder is useful.
 */
import { app } from 'electron';
import { createWriteStream, existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

let installed = false;

function logFilePath(): string {
  const dir = app.getPath('logs');
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  const stamp = new Date().toISOString().slice(0, 10);
  return join(dir, `edi-hub-${stamp}.log`);
}

export function installFileLogger(): void {
  if (installed) return;
  installed = true;

  const stream = createWriteStream(logFilePath(), { flags: 'a' });
  const write = (level: string, chunk: string): void => {
    const line = `[${new Date().toISOString()}] [${level}] ${chunk.replace(/\r?\n$/, '')}\n`;
    stream.write(line);
  };

  const origLog = console.log.bind(console);
  const origErr = console.error.bind(console);
  const origWarn = console.warn.bind(console);

  console.log = (...args: unknown[]) => {
    origLog(...args);
    write('info', args.map(String).join(' '));
  };
  console.error = (...args: unknown[]) => {
    origErr(...args);
    write('error', args.map(String).join(' '));
  };
  console.warn = (...args: unknown[]) => {
    origWarn(...args);
    write('warn', args.map(String).join(' '));
  };

  write('info', `--- EDI Hub v${app.getVersion()} session start (pid ${process.pid}) ---`);
  write('info', `userData: ${app.getPath('userData')}`);
}

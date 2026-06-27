/** PB-4 F13 — tenant quiet hours (UTC HH:MM). */

function parseHm(value: string): number | null {
  const m = /^(\d{1,2}):(\d{2})$/.exec(value.trim());
  if (!m) return null;
  const h = Number.parseInt(m[1]!, 10);
  const min = Number.parseInt(m[2]!, 10);
  if (h < 0 || h > 23 || min < 0 || min > 59) return null;
  return h * 60 + min;
}

/** True when `now` falls inside the quiet window (supports overnight spans). */
export function isInQuietHours(
  now: Date,
  start: string | null,
  end: string | null,
): boolean {
  if (!start || !end) return false;
  const startM = parseHm(start);
  const endM = parseHm(end);
  if (startM === null || endM === null) return false;
  const nowM = now.getUTCHours() * 60 + now.getUTCMinutes();
  if (startM <= endM) return nowM >= startM && nowM < endM;
  return nowM >= startM || nowM < endM;
}

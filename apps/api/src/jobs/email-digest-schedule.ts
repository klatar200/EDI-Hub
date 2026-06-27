/**
 * PS-11 F51 — compute delay until the next digest hour (UTC).
 */
export function msUntilDigestHour(hourUtc: number, from: Date = new Date()): number {
  const hour = Math.min(23, Math.max(0, Math.floor(hourUtc)));
  const next = new Date(from);
  next.setUTCMinutes(0, 0, 0);
  next.setUTCHours(hour);
  if (next.getTime() <= from.getTime()) {
    next.setUTCDate(next.getUTCDate() + 1);
  }
  return next.getTime() - from.getTime();
}

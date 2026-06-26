/** Pure throttle for download_progress log lines (unit-tested). */
export function shouldLogDownloadProgress(
  peakPercent: number,
  lastLoggedPercent: number,
  lastLoggedAtMs: number,
  nowMs: number,
): boolean {
  if (lastLoggedPercent < 0) return true;
  if (peakPercent >= 100 && lastLoggedPercent < 100) return true;
  const crossedBucket = Math.floor(peakPercent / 5) > Math.floor(lastLoggedPercent / 5);
  const timeElapsed = nowMs - lastLoggedAtMs >= 2000;
  return crossedBucket || timeElapsed;
}

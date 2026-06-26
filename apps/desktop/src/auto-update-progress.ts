/** Never let the splash bar move backward — differential fallback looks like a re-download. */
export function mergeDownloadPercent(peakPercent: number, nextPercent: number): {
  peakPercent: number;
  hint?: string;
} {
  if (nextPercent < peakPercent - 2) {
    return { peakPercent, hint: 'Finishing download…' };
  }
  return { peakPercent: Math.max(peakPercent, nextPercent) };
}

/** Semver-ish compare for 0.0.x desktop builds (ignores prerelease suffix). */
export function isNewerVersion(candidate: string, current: string): boolean {
  const core = (v: string) => v.split('-')[0]!.split('.').map((n) => Number.parseInt(n, 10));
  const c = core(candidate);
  const r = core(current);
  for (let i = 0; i < 3; i++) {
    const a = c[i] ?? 0;
    const b = r[i] ?? 0;
    if (a > b) return true;
    if (a < b) return false;
  }
  return false;
}

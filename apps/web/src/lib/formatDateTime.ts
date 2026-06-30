/** UR2/R43 — locale-aware dates; compact form for cards and narrow tables. */
export function formatDateTime(
  iso: string | null | undefined,
  options?: { compact?: boolean },
): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  if (options?.compact) {
    return d.toLocaleString(undefined, {
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
    });
  }
  return d.toLocaleString();
}

export function formatDateOnly(raw: string | null | undefined, compact?: boolean): string {
  if (!raw) return '—';
  if (/^\d{8}$/.test(raw)) {
    const y = raw.slice(0, 4);
    const m = raw.slice(4, 6);
    const day = raw.slice(6, 8);
    const d = new Date(`${y}-${m}-${day}T12:00:00Z`);
    if (compact) {
      return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
    }
    return d.toLocaleDateString();
  }
  return raw;
}

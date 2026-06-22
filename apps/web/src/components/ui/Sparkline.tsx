/**
 * UI Phase Sprint 5.1 — Sparkline.
 *
 * Tiny SVG sparkline — useful inline next to a metric for trend at a
 * glance. Two variants:
 *   - `<Sparkline.Line values={...}/>`  — connected line + optional fill.
 *   - `<Sparkline.RateBar value={0.4} />` — single horizontal bar
 *     coloring green/amber/red depending on threshold (used by the
 *     metrics page).
 *
 * No external chart library. Token-colored stroke. Renders nothing
 * when values is empty / undefined.
 */

interface LineProps {
  /** Series values, oldest first. Empty / single-value series render nothing. */
  values: ReadonlyArray<number>;
  /** Width in CSS pixels. Default 80. */
  width?: number;
  /** Height in CSS pixels. Default 24. */
  height?: number;
  /** Stroke color CSS — defaults to the brand token. */
  stroke?: string;
  /** Fill below the line — null for no fill. Defaults to a 12% brand tint. */
  fill?: string | null;
  /** Stroke width in CSS pixels. */
  strokeWidth?: number;
}

function Line({
  values,
  width = 80,
  height = 24,
  stroke = 'var(--color-brand-500)',
  fill = 'color-mix(in oklch, var(--color-brand-500) 12%, transparent)',
  strokeWidth = 1.5,
}: LineProps): JSX.Element | null {
  if (!values || values.length < 2) return null;

  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min || 1; // avoid divide-by-zero on flat series
  const stepX = width / (values.length - 1);

  // Project values onto the SVG canvas with a 1px padding so the stroke
  // doesn't clip at the top / bottom edges.
  const pad = strokeWidth;
  const usable = height - pad * 2;
  const points = values.map((v, i) => {
    const x = i * stepX;
    const y = pad + usable - ((v - min) / range) * usable;
    return [x, y] as const;
  });

  const path = points.map(([x, y], i) => `${i === 0 ? 'M' : 'L'} ${x.toFixed(1)} ${y.toFixed(1)}`).join(' ');
  // Closed path for the fill — line back to baseline at end, then start.
  const fillPath = `${path} L ${points[points.length - 1]![0].toFixed(1)} ${height} L 0 ${height} Z`;

  return (
    <svg
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      role="img"
      aria-label="sparkline"
      className="overflow-visible"
    >
      {fill ? <path d={fillPath} fill={fill} /> : null}
      <path d={path} fill="none" stroke={stroke} strokeWidth={strokeWidth} strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  );
}

interface RateBarProps {
  /** Rate in [0, 1]. Values outside the range are clamped. */
  value: number;
  /** Width in CSS pixels. Default 96. */
  width?: number;
  /** Threshold for amber (default 2%) and red (default 10%). */
  amberAt?: number;
  redAt?: number;
}

function RateBar({ value, width = 96, amberAt = 0.02, redAt = 0.1 }: RateBarProps): JSX.Element {
  const clamped = Math.max(0, Math.min(1, value));
  const tone =
    clamped >= redAt
      ? 'bg-[var(--color-error-500)]'
      : clamped >= amberAt
      ? 'bg-[var(--color-warn-500)]'
      : 'bg-[var(--color-success-500)]';
  return (
    <div
      className="h-2 overflow-hidden rounded-full bg-[var(--color-surface-muted)]"
      style={{ width }}
      role="meter"
      aria-valuenow={Math.round(clamped * 100)}
      aria-valuemin={0}
      aria-valuemax={100}
    >
      <div className={`h-full ${tone}`} style={{ width: `${clamped * 100}%` }} />
    </div>
  );
}

export const Sparkline = { Line, RateBar };

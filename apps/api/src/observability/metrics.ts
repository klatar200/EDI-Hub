/**
 * Phase 10 Sprint 1.2 — Tiny in-house Prometheus metrics registry.
 *
 * We need five metrics; pulling in `prom-client` for that is overkill.
 * This module emits OpenMetrics 1.0.0 text exposition format directly, so
 * Prometheus + Grafana + Datadog scraping all work out of the box.
 *
 * Exposed via GET /internal/metrics (no auth, intended to be VPC-only —
 * the ALB security group must NOT route `/internal/*` from the public
 * listener; the readiness/liveness handlers stay on `/health`/`/readiness`).
 *
 * Metric inventory:
 *   - http_requests_total            counter, labeled (route, method, status)
 *   - http_request_duration_seconds  histogram, labeled (route, method)
 *   - http_in_flight_requests        gauge
 *   - ingestion_channel_up           gauge, labeled (channel, source)
 *   - process_uptime_seconds         gauge (free; useful for noticing restarts)
 */

/** Histogram buckets in seconds — covers fast reads (<50 ms) through
 *  multi-second ingestion. Matches the Gate-E target distribution. */
const LATENCY_BUCKETS = [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2, 5, 10];

type LabelSet = Readonly<Record<string, string>>;

function labelKey(labels: LabelSet): string {
  // Stable JSON encoding — keys sorted so equal label sets hash identically.
  const keys = Object.keys(labels).sort();
  return keys.map((k) => `${k}=${labels[k]!}`).join(',');
}

function renderLabels(labels: LabelSet): string {
  const keys = Object.keys(labels).sort();
  if (keys.length === 0) return '';
  const parts = keys.map((k) => `${k}="${escapeLabel(labels[k]!)}"`);
  return `{${parts.join(',')}}`;
}

function escapeLabel(v: string): string {
  return v.replace(/\\/g, '\\\\').replace(/\n/g, '\\n').replace(/"/g, '\\"');
}

class Counter {
  private values = new Map<string, { labels: LabelSet; value: number }>();
  constructor(readonly name: string, readonly help: string) {}
  inc(labels: LabelSet = {}, by = 1): void {
    const key = labelKey(labels);
    const existing = this.values.get(key);
    if (existing) existing.value += by;
    else this.values.set(key, { labels, value: by });
  }
  render(): string {
    const lines = [`# HELP ${this.name} ${this.help}`, `# TYPE ${this.name} counter`];
    for (const { labels, value } of this.values.values()) {
      lines.push(`${this.name}${renderLabels(labels)} ${value}`);
    }
    return lines.join('\n');
  }
}

class Gauge {
  private values = new Map<string, { labels: LabelSet; value: number }>();
  constructor(readonly name: string, readonly help: string) {}
  set(value: number, labels: LabelSet = {}): void {
    this.values.set(labelKey(labels), { labels, value });
  }
  inc(labels: LabelSet = {}, by = 1): void {
    const key = labelKey(labels);
    const existing = this.values.get(key);
    if (existing) existing.value += by;
    else this.values.set(key, { labels, value: by });
  }
  dec(labels: LabelSet = {}, by = 1): void { this.inc(labels, -by); }
  render(): string {
    const lines = [`# HELP ${this.name} ${this.help}`, `# TYPE ${this.name} gauge`];
    for (const { labels, value } of this.values.values()) {
      lines.push(`${this.name}${renderLabels(labels)} ${value}`);
    }
    return lines.join('\n');
  }
}

interface HistogramSeries {
  labels: LabelSet;
  bucketCounts: number[]; // parallel to LATENCY_BUCKETS
  sum: number;
  count: number;
}

class Histogram {
  private series = new Map<string, HistogramSeries>();
  constructor(readonly name: string, readonly help: string) {}
  observe(value: number, labels: LabelSet = {}): void {
    const key = labelKey(labels);
    let s = this.series.get(key);
    if (!s) {
      s = { labels, bucketCounts: new Array(LATENCY_BUCKETS.length).fill(0), sum: 0, count: 0 };
      this.series.set(key, s);
    }
    for (let i = 0; i < LATENCY_BUCKETS.length; i += 1) {
      if (value <= LATENCY_BUCKETS[i]!) s.bucketCounts[i] = (s.bucketCounts[i] ?? 0) + 1;
    }
    s.sum += value;
    s.count += 1;
  }
  render(): string {
    const lines = [`# HELP ${this.name} ${this.help}`, `# TYPE ${this.name} histogram`];
    for (const s of this.series.values()) {
      // Cumulative bucket counts per OpenMetrics convention.
      let cum = 0;
      for (let i = 0; i < LATENCY_BUCKETS.length; i += 1) {
        cum += s.bucketCounts[i] ?? 0;
        const le = String(LATENCY_BUCKETS[i]);
        lines.push(`${this.name}_bucket${renderLabels({ ...s.labels, le })} ${cum}`);
      }
      lines.push(`${this.name}_bucket${renderLabels({ ...s.labels, le: '+Inf' })} ${s.count}`);
      lines.push(`${this.name}_sum${renderLabels(s.labels)} ${s.sum}`);
      lines.push(`${this.name}_count${renderLabels(s.labels)} ${s.count}`);
    }
    return lines.join('\n');
  }
}

/** Project-wide metrics registry. One module-level singleton; tests can
 *  call `resetMetrics()` to start clean. */
export const metrics = {
  httpRequestsTotal: new Counter(
    'http_requests_total',
    'Total HTTP requests handled, labeled by route + method + status.',
  ),
  httpRequestDurationSeconds: new Histogram(
    'http_request_duration_seconds',
    'HTTP request latency in seconds.',
  ),
  httpInFlightRequests: new Gauge(
    'http_in_flight_requests',
    'Number of HTTP requests currently being processed.',
  ),
  ingestionChannelUp: new Gauge(
    'ingestion_channel_up',
    '1 when the ingestion channel is running, 0 when disabled or errored.',
  ),
  processUptimeSeconds: new Gauge(
    'process_uptime_seconds',
    'Seconds since the API process started — resets on restart.',
  ),
};

const PROCESS_START = Date.now();

/** Render every metric as a single OpenMetrics-compatible text blob. */
export function renderMetrics(): string {
  metrics.processUptimeSeconds.set((Date.now() - PROCESS_START) / 1000);
  return [
    metrics.httpRequestsTotal.render(),
    metrics.httpRequestDurationSeconds.render(),
    metrics.httpInFlightRequests.render(),
    metrics.ingestionChannelUp.render(),
    metrics.processUptimeSeconds.render(),
    '', // trailing newline per OpenMetrics spec
  ].join('\n');
}

/** Drop every recorded series. Test-only — tests pre-warm the registry
 *  with their own observations and shouldn't see leftovers from other
 *  tests in the same Node process. */
export function resetMetrics(): void {
  metrics.httpRequestsTotal = new Counter(metrics.httpRequestsTotal.name, metrics.httpRequestsTotal.help);
  metrics.httpRequestDurationSeconds = new Histogram(metrics.httpRequestDurationSeconds.name, metrics.httpRequestDurationSeconds.help);
  metrics.httpInFlightRequests = new Gauge(metrics.httpInFlightRequests.name, metrics.httpInFlightRequests.help);
  metrics.ingestionChannelUp = new Gauge(metrics.ingestionChannelUp.name, metrics.ingestionChannelUp.help);
  metrics.processUptimeSeconds = new Gauge(metrics.processUptimeSeconds.name, metrics.processUptimeSeconds.help);
}

/**
 * The metrics listener (design 10.2, review 9; package M13-14): a SEPARATE HTTP server on `METRICS_PORT` (on the container network only; the proxy never
 * routes it), serving the Prometheus text format at `/metrics`; every request needs `Authorization: Bearer <METRICS_TOKEN>` (compared in constant time,
 * before anything else is looked at: a request without the token learns nothing about the paths). Moved out of `gateway/metrics.ts`, which re-exports it.
 *
 * `PrometheusMetrics` is a minimal registry behind the `Metrics` interface of obs.ts (names, labels and label values checked by `checkMetric`):
 * `inc` is a counter, `set` a gauge, `observe` a histogram (cumulative buckets chosen by the metric's unit, `_sum` and `_count`). Series are
 * bounded: the labels have closed sets of values and there is no label that holds an id, a name or an address.
 */
import { timingSafeEqual } from 'node:crypto';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { checkMetric, METRICS, MemoryMetrics, type Labels, type MetricName, type Metrics } from '../obs';

/** One line of help per metric (the `# HELP` of the exposition). */
export const METRIC_HELP: Readonly<Record<MetricName, string>> = {
  [METRICS.connections]: 'Open client connections.',
  [METRICS.sessions]: 'Guest sessions seen since start or loaded.',
  [METRICS.tables]: 'Tables by status.',
  [METRICS.actions]: 'Game actions applied.',
  [METRICS.actionSeconds]: 'Server-side time of an action: command in to the last seat\'s payload out.',
  [METRICS.applySeconds]: 'Engine apply time of an action.',
  [METRICS.viewSeconds]: 'Time to build the seats\' views of an action.',
  [METRICS.patchSeconds]: 'Time to build the seats\' patches of an action.',
  [METRICS.commitSeconds]: 'Time of a group commit to the store.',
  [METRICS.workerLagSeconds]: 'Event-loop lag of a game worker.',
  [METRICS.workerHeapBytes]: 'Heap in use of a game worker.',
  [METRICS.outboundBytes]: 'Bytes queued or buffered for clients, all connections.',
  [METRICS.connectionsBehind]: 'Connections that are behind (their outbound backlog is past the budget).',
  [METRICS.refusals]: 'Refusals and closes by reason (rate limits, serverBusy, origin, ...).',
  [METRICS.strikes]: 'Strikes given to connections.',
  [METRICS.timeouts]: 'Players timed out.',
  [METRICS.drops]: 'Players dropped (disconnected during a game).',
  [METRICS.forfeits]: 'Forfeits.',
  [METRICS.abandonments]: 'Games abandoned.',
  [METRICS.voids]: 'Games voided by reason.',
  [METRICS.quarantines]: 'Tables quarantined.',
  [METRICS.watchdogTerminations]: 'Game workers terminated by the watchdog.',
  [METRICS.engineErrors]: 'Engine errors.',
  [METRICS.recoveries]: 'Table recoveries.',
  [METRICS.matchQueue]: 'Players waiting in the matchmaking queue by format and size.',
  [METRICS.matchWaitSeconds]: 'Time players waited in the matchmaking queue before a match.',
  [METRICS.capacityUnits]: 'Capacity units of running games.',
  [METRICS.capacitySoft]: '1 while a soft capacity limit is set, by signal.',
  [METRICS.capacityQueueStarts]: 'Starts waiting in the capacity queue.',
  [METRICS.capacityQueueUnits]: 'Capacity units the waiting starts need.',
  [METRICS.capacityWaitSeconds]: 'Time a start waited in the capacity queue before admission.',
  [METRICS.capacityHeadAgeSeconds]: 'Age of the start at the head of the capacity queue.',
  [METRICS.capacityLeft]: 'Waiting starts that left the capacity queue before admission.',
  [METRICS.readyCheckFailures]: 'Ready checks that failed.',
};

/** Bucket bounds (seconds) of the metrics that time one step of a game: a millisecond to ten seconds (the watchdog stops a worker's message at five). */
export const LATENCY_BUCKETS: readonly number[] = [0.001, 0.0025, 0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10];
/** Bucket bounds (seconds) of the metrics that time a wait in a queue: a second to an hour (the capacity wait's maximum is configurable). */
export const WAIT_BUCKETS: readonly number[] = [1, 5, 15, 30, 60, 120, 300, 600, 1_800, 3_600];

const WAIT_METRICS: ReadonlySet<string> = new Set([METRICS.matchWaitSeconds, METRICS.capacityWaitSeconds]);

/** The bucket bounds of an observed metric. */
export function bucketsOf(name: MetricName): readonly number[] {
  return WAIT_METRICS.has(name) ? WAIT_BUCKETS : LATENCY_BUCKETS;
}

interface Sample {
  name: MetricName;
  labels: Labels;
  value: number;
  kind: 'counter' | 'gauge';
}

interface Histogram {
  name: MetricName;
  labels: Labels;
  /** Observations in each bucket (not cumulative; the exposition adds them up), and one past the last bound. */
  counts: number[];
  count: number;
  sum: number;
}

/** A sample value as the text format writes it. */
function formatNumber(v: number): string {
  if (Number.isNaN(v)) return 'NaN';
  if (!Number.isFinite(v)) return v > 0 ? '+Inf' : '-Inf';
  return String(v);
}

function escapeLabelValue(v: string): string {
  return v.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n');
}

/** `{a="1",b="2"}` (keys sorted; `extra` last), or "" without labels. */
function labelText(labels: Labels, extra?: [string, string]): string {
  const pairs: [string, string][] = Object.entries(labels).filter((e): e is [string, string] => typeof e[1] === 'string').sort(([a], [b]) => a.localeCompare(b));
  if (extra) pairs.push(extra);
  return pairs.length ? `{${pairs.map(([k, v]) => `${k}="${escapeLabelValue(v)}"`).join(',')}}` : '';
}

export class PrometheusMetrics implements Metrics {
  private readonly values = new Map<string, Sample>();
  private readonly observed = new Map<string, Histogram>();

  /** `workers`: the configured game worker count (the `worker` label's values are 0 to workers - 1). */
  constructor(private readonly workers = 1) {}

  /** A counter goes up by `by`; a negative or non-finite step is a programming error and is ignored (a counter never goes down). */
  inc(name: MetricName, labels: Labels = {}, by = 1): void {
    checkMetric(name, labels, this.workers);
    if (!Number.isFinite(by) || by < 0) return;
    const k = MemoryMetrics.key(name, labels);
    const v = this.values.get(k);
    if (v) v.value += by;
    else this.values.set(k, { name, labels, value: by, kind: 'counter' });
  }

  /** A gauge takes `value`; a value that is not a finite number is ignored (it would poison the series). */
  set(name: MetricName, value: number, labels: Labels = {}): void {
    checkMetric(name, labels, this.workers);
    if (!Number.isFinite(value)) return;
    this.values.set(MemoryMetrics.key(name, labels), { name, labels, value, kind: 'gauge' });
  }

  /** A histogram takes `value` (seconds); a value that is not a finite number is ignored, a negative one (clock skew) counts as 0. */
  observe(name: MetricName, value: number, labels: Labels = {}): void {
    checkMetric(name, labels, this.workers);
    if (!Number.isFinite(value)) return;
    const v = Math.max(0, value);
    const k = MemoryMetrics.key(name, labels);
    let h = this.observed.get(k);
    if (!h) {
      h = { name, labels, counts: new Array<number>(bucketsOf(name).length + 1).fill(0), count: 0, sum: 0 };
      this.observed.set(k, h);
    }
    const bounds = bucketsOf(name);
    let i = bounds.findIndex((b) => v <= b);
    if (i < 0) i = bounds.length;
    h.counts[i]!++;
    h.count++;
    h.sum += v;
  }

  /** The Prometheus text exposition: families sorted by name, each with its HELP and TYPE, series sorted by labels. */
  text(): string {
    const families = new Map<string, { type: 'counter' | 'gauge' | 'histogram'; lines: [string, string][] }>();
    const family = (name: string, type: 'counter' | 'gauge' | 'histogram') => {
      let f = families.get(name);
      if (!f) {
        f = { type, lines: [] };
        families.set(name, f);
      }
      return f;
    };
    for (const s of this.values.values()) family(s.name, s.kind).lines.push([labelText(s.labels), `${s.name}${labelText(s.labels)} ${formatNumber(s.value)}`]);
    for (const h of this.observed.values()) {
      const f = family(h.name, 'histogram');
      const own = labelText(h.labels);
      const bounds = bucketsOf(h.name);
      let cumulative = 0;
      const lines: string[] = [];
      for (let i = 0; i < bounds.length; i++) {
        cumulative += h.counts[i]!;
        lines.push(`${h.name}_bucket${labelText(h.labels, ['le', formatNumber(bounds[i]!)])} ${cumulative}`);
      }
      lines.push(`${h.name}_bucket${labelText(h.labels, ['le', '+Inf'])} ${h.count}`, `${h.name}_sum${own} ${formatNumber(h.sum)}`, `${h.name}_count${own} ${h.count}`);
      f.lines.push([own, lines.join('\n')]);
    }
    const out: string[] = [];
    for (const name of [...families.keys()].sort()) {
      const f = families.get(name)!;
      out.push(`# HELP ${name} ${METRIC_HELP[name as MetricName]}`, `# TYPE ${name} ${f.type}`);
      for (const [, line] of f.lines.sort(([a], [b]) => a.localeCompare(b))) out.push(line);
    }
    return out.length ? `${out.join('\n')}\n` : '';
  }
}

/** Whether `header` is exactly `Bearer <token>` (constant time in the token's length). */
export function bearerMatches(header: string | undefined, token: string): boolean {
  if (typeof header !== 'string' || !header.startsWith('Bearer ')) return false;
  const given = Buffer.from(header.slice(7), 'utf8');
  const want = Buffer.from(token, 'utf8');
  if (given.length !== want.length) {
    timingSafeEqual(want, want);
    return false;
  }
  return timingSafeEqual(given, want);
}

/** The text format's content type (version 0.0.4). */
export const METRICS_CONTENT_TYPE = 'text/plain; version=0.0.4; charset=utf-8';
export const METRICS_PATH = '/metrics';

/** The metrics listener (not listening yet): GET `/metrics` with the bearer token; 401 without it, 404 for any other path or method. */
export function createMetricsServer(metrics: PrometheusMetrics, token: string): Server {
  const server = createServer({ maxHeaderSize: 8 * 1024 }, (req: IncomingMessage, res: ServerResponse) => {
    try {
      if (!bearerMatches(req.headers.authorization, token)) {
        res.writeHead(401, { 'Content-Length': 0, 'Cache-Control': 'no-store', 'WWW-Authenticate': 'Bearer' });
        return res.end();
      }
      if (req.method !== 'GET' || req.url !== METRICS_PATH) {
        res.writeHead(404, { 'Content-Length': 0 });
        return res.end();
      }
      const body = metrics.text();
      res.writeHead(200, { 'Content-Type': METRICS_CONTENT_TYPE, 'Content-Length': Buffer.byteLength(body), 'Cache-Control': 'no-store' });
      res.end(body);
    } catch {
      res.destroy();
    }
  });
  // Slow request headers or bodies cannot hold sockets for long.
  server.headersTimeout = 10_000;
  server.requestTimeout = 15_000;
  server.keepAliveTimeout = 5_000;
  return server;
}

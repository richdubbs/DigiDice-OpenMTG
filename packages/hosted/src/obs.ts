/**
 * Observability's contract (design 10.2, 6.3): the structured logger and the metrics every package of milestone 13 writes to. The stdout JSON logger
 * and its scrubbing live in `./obs/logger` (M13-14), re-exported here; the Prometheus text and the metrics listener (on its own port, token required)
 * live in `./obs/prometheus`. Tests use `MemoryLogger` and `MemoryMetrics`.
 *
 * Logs name games, seats and action types, never card names of hidden zones, decklists, tokens, passwords, invite codes, seeds or chat text
 * (design 6.3, 10.2); `./obs/logger` says what it enforces.
 * Metric labels are limited to a small fixed set (`METRIC_LABELS`) with closed sets of values (`METRIC_LABEL_VALUES`, `checkMetric`), so no game id,
 * session, name or other free value becomes a label (and the number of series stays bounded).
 */
import { CLIENT_MESSAGE_FIELDS, HOSTED_ERROR_CODES, HOSTED_FORMATS, LOSS_CODES, NOTICE_KINDS } from './api';
import { ADMISSION_REFUSALS } from './admission/api';
import { VOID_REASONS } from './ledger/types';

export * from './obs/logger';

// ---------------------------------------------------------------------------------------------------------------------------------------------------
// Metrics

/** The only label names a metric may have (bounded values: formats, statuses, reasons, kinds, signals, workers). */
export const METRIC_LABELS = ['format', 'status', 'reason', 'kind', 'signal', 'worker', 'store', 'size'] as const;
export type MetricLabel = (typeof METRIC_LABELS)[number];
export type Labels = Partial<Record<MetricLabel, string>>;

/** The metric names of design 10.2 and 4.6 (Prometheus naming: `openmtg_hosted_` prefix, `_total` counters, `_seconds` / `_bytes` units). */
export const METRICS = {
  connections: 'openmtg_hosted_connections',
  sessions: 'openmtg_hosted_sessions',
  tables: 'openmtg_hosted_tables', // by status
  actions: 'openmtg_hosted_actions_total',
  actionSeconds: 'openmtg_hosted_action_seconds', // server-side action time: message in to the last seat's payload out
  applySeconds: 'openmtg_hosted_apply_seconds',
  viewSeconds: 'openmtg_hosted_view_seconds',
  patchSeconds: 'openmtg_hosted_patch_seconds',
  commitSeconds: 'openmtg_hosted_commit_seconds',
  workerLagSeconds: 'openmtg_hosted_worker_lag_seconds',
  workerHeapBytes: 'openmtg_hosted_worker_heap_bytes',
  outboundBytes: 'openmtg_hosted_outbound_bytes',
  connectionsBehind: 'openmtg_hosted_connections_behind',
  refusals: 'openmtg_hosted_refusals_total', // by reason (rate limits, serverBusy, ...)
  strikes: 'openmtg_hosted_strikes_total',
  timeouts: 'openmtg_hosted_timeouts_total',
  drops: 'openmtg_hosted_drops_total',
  forfeits: 'openmtg_hosted_forfeits_total',
  abandonments: 'openmtg_hosted_abandonments_total',
  voids: 'openmtg_hosted_voids_total', // by reason
  quarantines: 'openmtg_hosted_quarantines_total',
  watchdogTerminations: 'openmtg_hosted_watchdog_terminations_total',
  engineErrors: 'openmtg_hosted_engine_errors_total',
  recoveries: 'openmtg_hosted_recoveries_total',
  matchQueue: 'openmtg_hosted_match_queue', // by format, size
  matchWaitSeconds: 'openmtg_hosted_match_wait_seconds',
  capacityUnits: 'openmtg_hosted_capacity_units', // running units
  capacitySoft: 'openmtg_hosted_capacity_soft', // 1 while the soft limit is set, by signal
  capacityQueueStarts: 'openmtg_hosted_capacity_queue_starts',
  capacityQueueUnits: 'openmtg_hosted_capacity_queue_units',
  capacityWaitSeconds: 'openmtg_hosted_capacity_wait_seconds',
  capacityHeadAgeSeconds: 'openmtg_hosted_capacity_head_age_seconds',
  capacityLeft: 'openmtg_hosted_capacity_left_total', // waiting starts that left the capacity queue before admission (M13-10; 4.6's "entries that left")
  readyCheckFailures: 'openmtg_hosted_ready_check_failures_total',
} as const;
export type MetricName = (typeof METRICS)[keyof typeof METRICS];

export interface Metrics {
  inc(name: MetricName, labels?: Labels, by?: number): void;
  set(name: MetricName, value: number, labels?: Labels): void;
  observe(name: MetricName, value: number, labels?: Labels): void;
}

const NAMES: ReadonlySet<string> = new Set(Object.values(METRICS));
const LABELS: ReadonlySet<string> = new Set(METRIC_LABELS);

/**
 * The closed set of values of each label but `worker` (a game worker's index, 0 to WORKERS - 1, checked against the worker count). A value outside
 * its set is a programming error: `checkMetric` throws.
 */
export const METRIC_LABEL_VALUES: Readonly<Record<Exclude<MetricLabel, 'worker'>, readonly string[]>> = {
  format: HOSTED_FORMATS.map((f) => f.id),
  size: ['2', '3', '4', 'pod'],
  status: ['lobby', 'waitingCapacity', 'readyCheck', 'playing', 'over', 'running', 'finished', 'void', 'quarantined'],
  signal: ['units', 'cpu', 'p95', 'heap', 'outbound', 'store'],
  store: ['memory', 'file', 'postgres'],
  reason: [
    ...VOID_REASONS, ...HOSTED_ERROR_CODES, ...ADMISSION_REFUSALS,
    // the gateway's refusals and closes (design 3.1, 3.5, 3.6, 11)
    'origin', 'proxy', 'frame', 'binary', 'depth', 'hello', 'strikes', 'behind', 'outbound', 'dead', 'replaced', 'sockets', 'sessions', 'connections',
    'joinLocked', 'watchers', 'lobbyFull', 'listedFull', 'watchdog', 'oom', 'crash',
    // capacity admission (4.6): a start that waited past the maximum (`CAPACITY_WAIT_MAX_MINUTES`); `capacityLeft`'s why: it asked to leave, or its seats changed
    'capacityTimeout', 'withdrawn', 'seats',
  ],
  kind: [
    ...Object.keys(CLIENT_MESSAGE_FIELDS), ...NOTICE_KINDS, ...LOSS_CODES,
    'bug', 'title', 'table', 'match', 'capacity', 'action', 'snapshot', 'recovery', 'commit', 'view', 'patch', 'listed', 'private', 'matched',
  ],
};

/**
 * Throws for a name that is not one of `METRICS`, a label that is not one of `METRIC_LABELS`, or a label value outside its closed set (`worker`: a
 * whole number below `workers`, the configured WORKERS). A programming error, caught by tests.
 */
export function checkMetric(name: string, labels: Labels = {}, workers = 1): void {
  if (!NAMES.has(name)) throw new Error(`Unknown metric ${name}.`);
  for (const [k, v] of Object.entries(labels)) {
    if (!LABELS.has(k)) throw new Error(`Metric ${name}: label ${k} is not allowed.`);
    if (k === 'worker') {
      if (typeof v !== 'string' || !/^(0|[1-9]\d{0,3})$/.test(v) || Number(v) >= workers) throw new Error(`Metric ${name}: worker ${String(v)} is not below ${workers}.`);
    } else if (typeof v !== 'string' || !METRIC_LABEL_VALUES[k as Exclude<MetricLabel, 'worker'>].includes(v)) {
      throw new Error(`Metric ${name}: ${k}=${JSON.stringify(v)} is not one of its values.`);
    }
  }
}

/** The test double: values kept in memory by name and labels; names and labels are checked. */
export class MemoryMetrics implements Metrics {
  readonly values = new Map<string, number>();
  readonly observations = new Map<string, number[]>();
  /** `workers`: the configured game worker count (the `worker` label's values are 0 to workers - 1). */
  constructor(private readonly workers = 1) {}

  static key(name: string, labels: Labels = {}): string {
    const ls = Object.entries(labels).sort(([a], [b]) => a.localeCompare(b));
    return ls.length ? `${name}{${ls.map(([k, v]) => `${k}=${JSON.stringify(v)}`).join(',')}}` : name;
  }

  inc(name: MetricName, labels: Labels = {}, by = 1): void {
    checkMetric(name, labels, this.workers);
    const k = MemoryMetrics.key(name, labels);
    this.values.set(k, (this.values.get(k) ?? 0) + by);
  }
  set(name: MetricName, value: number, labels: Labels = {}): void {
    checkMetric(name, labels, this.workers);
    this.values.set(MemoryMetrics.key(name, labels), value);
  }
  observe(name: MetricName, value: number, labels: Labels = {}): void {
    checkMetric(name, labels, this.workers);
    const k = MemoryMetrics.key(name, labels);
    const list = this.observations.get(k) ?? [];
    list.push(value);
    this.observations.set(k, list);
  }
}

export const NULL_METRICS: Metrics = { inc: () => {}, set: () => {}, observe: () => {} };

/** Test helpers for capacity admission (fake time only: every instant is an explicit number of milliseconds; the signals are set by hand). */
import type { TableSize, TableSource } from '@openmtg/hosted';
import {
  CapacityAdmission, startRequestFor, type AdmissionDecision, type AdmissionEvent, type AdmissionLimits, type AdmissionTiming, type CapacitySignals, type SignalSource,
  type StartRequest,
} from '../../src/admission';
import { MemoryLogger, MemoryMetrics, type Labels, type MetricName } from '../../src/obs';

export const SEC = 1_000;
export const MIN = 60_000;

/** A calm server: nothing running, every signal well under its soft level. */
export const CALM: Readonly<CapacitySignals> = { runningUnits: 0, cpu: 0.1, p95ActionMs: 20, workerHeap: 0.3, outbound: 0.05 };

/** The signals the runtime would report, set by the test; counts how often admission read them. */
export class FakeSignals implements SignalSource {
  s: CapacitySignals = { ...CALM };
  reads = 0;

  read(): CapacitySignals {
    this.reads++;
    return { ...this.s };
  }

  set(p: Partial<CapacitySignals>): void {
    Object.assign(this.s, p);
  }
}

export interface StartOptions {
  seats?: TableSize;
  source?: TableSource;
  sessions?: string[];
  addressKeys?: string[];
  since?: number;
  units?: number;
}

/** What `Rig.start` tells the test about a request. */
export type Outcome = AdmissionDecision['kind'];

/**
 * An admission with a fake clock, hand-set signals, memory metrics and a memory logger. `start` builds a request for table `id` (its own sessions and
 * address key unless given), `go` advances time and ticks the way the timer wheel would.
 */
export class Rig {
  now: number;
  readonly sig = new FakeSignals();
  readonly metrics = new MemoryMetrics();
  readonly logger = new MemoryLogger({}, undefined, () => new Date(0));
  readonly adm: CapacityAdmission;
  /** Every event `tick`, `freed` and `released` returned, in order. */
  readonly events: AdmissionEvent[] = [];

  constructor(o: { limits?: Partial<AdmissionLimits>; timing?: Partial<AdmissionTiming>; now?: number; onEvents?: (events: AdmissionEvent[]) => void } = {}) {
    this.now = o.now ?? 1_000_000;
    // No pacing unless a test asks (the fake clock stands still within a test step: pacing has its own tests): each step may admit up to the capacity.
    const timing = { paceFraction: 1, paceEveryMs: 0, ...o.timing };
    this.adm = new CapacityAdmission({ signals: this.sig, limits: o.limits, timing, metrics: this.metrics, logger: this.logger, onEvents: o.onEvents });
  }

  /** The request for table `id` (without asking). Sessions `s:<id>:<n>` and address key `a:<id>` unless given. */
  req(id: string, o: StartOptions = {}): StartRequest {
    const seats = o.seats ?? 2;
    const r = startRequestFor({
      table: id,
      source: o.source ?? 'listed',
      seats,
      sessions: o.sessions ?? Array.from({ length: seats }, (_, i) => `s:${id}:${i + 1}`),
      addressKeys: o.addressKeys ?? [`a:${id}`],
      since: o.since ?? this.now,
    }, this.adm.limits.units);
    return o.units === undefined ? r : { ...r, units: o.units };
  }

  /** Asks for table `id`. */
  start(id: string, o: StartOptions = {}): AdmissionDecision {
    return this.adm.request(this.req(id, o), this.now);
  }

  /** Asks for table `id` and returns the decision's kind. */
  ask(id: string, o: StartOptions = {}): Outcome {
    return this.start(id, o).kind;
  }

  /** Time passes by `ms`, then the timer wheel's tick. Returns (and records) the events. */
  go(ms = 0): AdmissionEvent[] {
    this.now += ms;
    const ev = this.adm.tick(this.now);
    this.events.push(...ev);
    return ev;
  }

  /** A running game of `units` ended: the runtime's count falls by `units`, admission is told. */
  end(units: number): AdmissionEvent[] {
    this.sig.set({ runningUnits: this.sig.s.runningUnits - units });
    const ev = this.adm.freed(units, this.now);
    this.events.push(...ev);
    return ev;
  }

  /** The admitted game was created: the runtime counts it, admission ends the reservation (in that order). */
  begin(table: string, units: number): void {
    this.sig.set({ runningUnits: this.sig.s.runningUnits + units });
    this.adm.begun(table, this.now);
  }

  /** The table names of the events of one kind. */
  tables(ev: readonly AdmissionEvent[], kind: AdmissionEvent['kind']): string[] {
    return ev.filter((e) => e.kind === kind).map((e) => e.table);
  }

  value(name: MetricName, labels: Labels = {}): number | undefined {
    return this.metrics.values.get(MemoryMetrics.key(name, labels));
  }

  observed(name: MetricName, labels: Labels = {}): number[] {
    return this.metrics.observations.get(MemoryMetrics.key(name, labels)) ?? [];
  }
}

/** The position of a waiting decision (throws for another kind). */
export function waitingOf(d: AdmissionDecision): { position: number; unitsAhead: number; estimatedWaitMs: number | null } {
  if (d.kind !== 'waiting') throw new Error(`expected waiting, got ${JSON.stringify(d)}`);
  return { position: d.position, unitsAhead: d.unitsAhead, estimatedWaitMs: d.estimatedWaitMs };
}

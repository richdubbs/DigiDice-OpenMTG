/**
 * The capacity signals (design 4.6, 9.3; package M13-5) admission reads (`SignalSource.read`): running units, the game workers' CPU over the last 30 s
 * (the time they spent on messages, measured by the main thread from dispatch to reply), the server-side p95 action time over the last minute (an
 * `act` from its submission to its payloads' delivery: queueing, the worker and the group commit included), the fullest game worker's heap, and the
 * gateway's outbound budget. Times are the real monotonic clock (`performance.now`), whatever the runtime's server time is.
 */
import type { CapacitySignals, SignalSource } from '../admission/api';
import type { HeapReading } from './api';

export const CPU_WINDOW_MS = 30_000;
export const P95_WINDOW_MS = 60_000;
/**
 * A worker's heap reading counts for this long (M13-10 review): it is taken from the worker's replies, so a worker that goes quiet (its tables ended) would
 * otherwise keep its last reading, perhaps over the soft level, for ever, and admission would stay closed with nothing running.
 */
export const HEAP_MAX_AGE_MS = 30_000;

interface Sample {
  at: number;
  ms: number;
}

/** Samples in a time window (oldest dropped as time passes). */
class Window {
  private samples: Sample[] = [];
  private head = 0;
  constructor(private readonly ms: number) {}

  add(at: number, ms: number): void {
    this.samples.push({ at, ms });
  }

  live(now: number): Sample[] {
    while (this.head < this.samples.length && this.samples[this.head]!.at < now - this.ms) this.head++;
    if (this.head > 1024 && this.head > this.samples.length / 2) {
      this.samples = this.samples.slice(this.head);
      this.head = 0;
    }
    return this.samples.slice(this.head);
  }
}

/** The p-th percentile (nearest rank) of values; null for none. */
export function percentile(values: readonly number[], p: number): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const rank = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
  return sorted[rank]!;
}

export interface SignalInputs {
  runningUnits(): number;
  workers(): number;
  outbound(): number;
  /** The store is failing now (an outage): no starts. */
  store?(): boolean;
}

export class RuntimeSignals implements SignalSource {
  private readonly busy = new Window(CPU_WINDOW_MS);
  private readonly actions = new Window(P95_WINDOW_MS);
  private readonly heaps = new Map<number, { reading: HeapReading; at: number }>();

  constructor(private readonly inputs: SignalInputs, private readonly p95MinSamples: number, private readonly clock: () => number) {}

  /** A worker finished a message that took `ms` (real time). */
  workerBusy(ms: number, at = this.clock()): void {
    this.busy.add(at, ms);
  }

  /** An action's server-side time (submission to delivery). */
  actionTime(ms: number, at = this.clock()): void {
    this.actions.add(at, ms);
  }

  /** A worker's heap as of its last reply (`at`: the real clock); null forgets it (the worker is gone). It stops counting after `HEAP_MAX_AGE_MS`. */
  heap(worker: number, h: HeapReading | null, at = this.clock()): void {
    if (h) this.heaps.set(worker, { reading: h, at });
    else this.heaps.delete(worker);
  }

  /** The p95 action time of the window, or null before `p95MinSamples` samples. */
  p95(at = this.clock()): number | null {
    const live = this.actions.live(at);
    return live.length < this.p95MinSamples ? null : percentile(live.map((s) => s.ms), 95);
  }

  /** `now` is admission's server time; the windows use the real clock. */
  read(_now: number): CapacitySignals {
    const at = this.clock();
    const workers = Math.max(1, this.inputs.workers());
    let busy = 0;
    for (const s of this.busy.live(at)) busy += s.ms;
    let heap = 0;
    for (const [worker, { reading, at: seen }] of this.heaps) {
      if (seen < at - HEAP_MAX_AGE_MS) this.heaps.delete(worker);
      else if (reading.limit > 0) heap = Math.max(heap, reading.used / reading.limit);
    }
    return {
      runningUnits: this.inputs.runningUnits(),
      cpu: Math.min(1, busy / (CPU_WINDOW_MS * workers)),
      p95ActionMs: this.p95(at),
      workerHeap: heap,
      outbound: Math.min(1, Math.max(0, this.inputs.outbound())),
      ...(this.inputs.store?.() ? { store: true } : {}),
    };
  }
}

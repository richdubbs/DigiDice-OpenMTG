/**
 * The units freed by games that ended, over a sliding window (design 4.6: the wait estimate comes "from the units ahead and the rate at which units
 * have freed in the last 10 minutes"). Pure: `at` and `now` come from the caller (admission's server time).
 */
import { estimateWaitMs } from './api';

interface Freed {
  at: number;
  units: number;
}

export class FreedWindow {
  private freed: Freed[] = [];
  private head = 0;
  private total = 0;
  private first: number | null = null;

  /**
   * `windowMs`: how far back units count (10 minutes). `minSpanMs`: the shortest span a rate is taken over while the process is younger than the window
   * (so units freed in the first seconds do not promise a wait that is too short).
   */
  constructor(private readonly windowMs: number, private readonly minSpanMs: number) {}

  /** Notes that admission is in use from `now` (the first call counts; later ones do not). */
  start(now: number): void {
    if (this.first === null) this.first = now;
  }

  /** Notes `units` freed at `at`. Old entries are dropped here too, so the window stays small while nobody asks for an estimate (an empty queue). */
  add(units: number, at: number): void {
    this.prune(at);
    this.freed.push({ at, units });
    this.total += units;
  }

  /** The units freed in the last `windowMs` before `now`. */
  units(now: number): number {
    this.prune(now);
    return this.total;
  }

  /** Entries kept in memory (the window's, plus the dropped ones not yet compacted away): bounded by about twice the entries of one window. */
  get retained(): number {
    return this.freed.length;
  }

  private prune(now: number): void {
    while (this.head < this.freed.length && this.freed[this.head]!.at <= now - this.windowMs) this.total -= this.freed[this.head++]!.units;
    if (this.head > 256 && this.head > this.freed.length / 2) {
      this.freed = this.freed.slice(this.head);
      this.head = 0;
    }
  }

  /** The span the freed units are counted over: the window, or the time since `start` while that is shorter (never under `minSpanMs`). */
  span(now: number): number {
    const age = this.first === null ? 0 : Math.max(0, now - this.first);
    return Math.min(this.windowMs, Math.max(this.minSpanMs, age));
  }

  /** `estimateWaitMs` for a start with `unitsAhead` units before it (its own included); null when nothing freed in the window. */
  estimate(unitsAhead: number, now: number): number | null {
    return estimateWaitMs(unitsAhead, this.units(now), this.span(now));
  }
}

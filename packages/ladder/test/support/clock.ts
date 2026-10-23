/**
 * The fake clock of the ladder's tests (design 9.6; landed by M15-1, shared by M15-3, M15-4 and M15-6): a `LadderClock` whose time moves only when
 * a test moves it, so the matcher, the sweep and the season closes run on fixed inputs.
 *
 * `now` and `advance` are own properties (arrow functions), so `{ now: clock.now }` or a destructured `now` still reads this clock.
 */
import type { LadderClock } from '../../src/service/api';

/** 15 October 2026, 12:00 UTC: the middle of a month, so a test crosses a season boundary only when it means to. */
export const FAKE_CLOCK_START = Date.parse('2026-10-15T12:00:00.000Z');

function toMs(t: number | string): number {
  const ms = typeof t === 'number' ? t : Date.parse(t);
  if (!Number.isSafeInteger(ms) || ms < 0) throw new RangeError(`FakeClock: ${String(t)} is not a time in whole ms since the epoch`);
  return ms;
}

export class FakeClock implements LadderClock {
  #t: number;

  /** `start`: ms since the epoch, or an ISO-8601 time. */
  constructor(start: number | string = FAKE_CLOCK_START) {
    this.#t = toMs(start);
  }

  /** Ms since the epoch. */
  readonly now = (): number => this.#t;

  /** Moves the time forward by `ms` (a whole, non-negative number) and returns the new time. */
  readonly advance = (ms: number): number => {
    if (!Number.isSafeInteger(ms) || ms < 0) throw new RangeError(`FakeClock.advance: ${ms} is not a whole number of ms ≥ 0`);
    this.#t += ms;
    return this.#t;
  };

  /** Sets the time (forward or back: a test of a restart may need either); ms since the epoch, or an ISO-8601 time. */
  readonly set = (t: number | string): number => {
    this.#t = toMs(t);
    return this.#t;
  };

  /** The time as ISO-8601 UTC, the form the store and the views use. */
  readonly iso = (): string => new Date(this.#t).toISOString();
}

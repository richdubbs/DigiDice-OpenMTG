/** M15-1: the shared FakeClock (test/support/clock.ts, design 9.6): a LadderClock whose time moves only when the test moves it. */
import { describe, expect, it } from 'vitest';
import type { LadderClock } from '@openmtg/ladder';
import { FAKE_CLOCK_START, FakeClock } from '../support/clock';
import { counterIds } from '../support/random';

describe('M15-1: FakeClock', () => {
  it('starts in the middle of October 2026 unless told otherwise, and stands still', () => {
    const c = new FakeClock();
    expect(c.now()).toBe(FAKE_CLOCK_START);
    expect(c.iso()).toBe('2026-10-15T12:00:00.000Z');
    expect(c.now()).toBe(c.now());
    expect(new FakeClock('2026-12-31T23:59:59.999Z').now()).toBe(Date.parse('2026-12-31T23:59:59.999Z'));
    expect(new FakeClock(0).iso()).toBe('1970-01-01T00:00:00.000Z');
  });

  it('advance moves it forward and returns the new time; set jumps', () => {
    const c = new FakeClock('2026-10-31T23:59:59.000Z');
    expect(c.advance(1_000)).toBe(Date.parse('2026-11-01T00:00:00.000Z'));
    expect(c.iso()).toBe('2026-11-01T00:00:00.000Z');
    expect(c.advance(0)).toBe(c.now());
    expect(c.set('2026-10-01T00:00:00.000Z')).toBe(Date.parse('2026-10-01T00:00:00.000Z'));
    expect(c.now()).toBe(Date.parse('2026-10-01T00:00:00.000Z'));
  });

  it('refuses time going backwards through advance, fractions and bad times', () => {
    const c = new FakeClock();
    for (const ms of [-1, 0.5, Number.NaN, Number.POSITIVE_INFINITY]) expect(() => c.advance(ms), String(ms)).toThrow(RangeError);
    expect(c.now()).toBe(FAKE_CLOCK_START);
    expect(() => new FakeClock('not a time')).toThrow(RangeError);
    expect(() => c.set(-5)).toThrow(RangeError);
  });

  it('is a LadderClock whose methods work detached', () => {
    const c = new FakeClock();
    const port: LadderClock = { now: c.now };
    const { advance } = c;
    advance(5_000);
    expect(port.now()).toBe(FAKE_CLOCK_START + 5_000);
  });

  it('counterIds gives the deterministic match ids of 9.6', () => {
    const next = counterIds();
    expect([next(), next(), next()]).toEqual(['m1', 'm2', 'm3']);
    expect(counterIds('g')()).toBe('g1');
  });
});

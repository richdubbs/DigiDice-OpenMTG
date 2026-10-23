/**
 * Design 5.1-5.2 (owner answer 7): banks, control periods and the free delay, the animation allowance, time-outs (CR 104.3a), the rope, the readings.
 */
import { describe, expect, it } from 'vitest';
import { DEFAULT_CLOCKS } from '@openmtg/hosted';
import { CLOCK_TIMING, clocksAt, createTableClock, defaultClockSettings, ROPE_URGENT_MS, ropeFor } from '../../src/clock';
import { bank, delay, MIN, outs, running, runTo, SEC, seat, tick } from './helpers';

const BANK = 15 * MIN;

describe('M13-3: defaults (owner answer 7, 8)', () => {
  it('15 minutes per player 1v1, 20 in pods, 5 s free per control period, 5 minutes of disconnects per game', () => {
    expect(defaultClockSettings(2)).toEqual({ bankMs: 15 * MIN, delayMs: 5 * SEC, dropMs: 5 * MIN });
    expect(defaultClockSettings(3)).toEqual({ bankMs: 20 * MIN, delayMs: 5 * SEC, dropMs: 5 * MIN });
    expect(defaultClockSettings(4)).toEqual(DEFAULT_CLOCKS.pod);
    const c = createTableClock({ seats: 4, at: 0 });
    expect(c.view().seats.map((s) => s.bankMs)).toEqual([20 * MIN, 20 * MIN, 20 * MIN, 20 * MIN]);
    expect(c.view().seats.map((s) => s.dropMs)).toEqual([5 * MIN, 5 * MIN, 5 * MIN, 5 * MIN]);
    expect(createTableClock({ seats: 2, at: 0 }).view().seats).toHaveLength(2);
  });

  it('refuses a table size other than 2-4', () => {
    expect(() => createTableClock({ seats: 1, at: 0 })).toThrow();
    expect(() => createTableClock({ seats: 5, at: 0 })).toThrow();
  });

  it('nothing runs before the first decision', () => {
    const c = createTableClock({ seats: 2, at: 0 });
    expect(running(c)).toEqual([]);
    expect(tick(c, 10 * MIN)).toEqual([]);
    expect(bank(c, 1)).toBe(BANK);
    expect(bank(c, 2)).toBe(BANK);
  });
});

describe('M13-3: control periods and the delay (design 5.1, review 1)', () => {
  it('the first decision gets the free delay; then the bank runs; only the deciding seat\'s bank', () => {
    const c = createTableClock({ seats: 2, at: 0 });
    c.handle({ type: 'decision', at: 0, seat: seat(1) });
    expect(running(c)).toEqual([1]);
    expect(delay(c, 1, 3 * SEC)).toBe(2 * SEC);
    expect(bank(c, 1, 3 * SEC)).toBe(BANK);
    expect(bank(c, 1, 8 * SEC)).toBe(BANK - 3 * SEC);
    expect(delay(c, 1, 8 * SEC)).toBe(0);
    expect(bank(c, 2, 8 * SEC)).toBe(BANK);
  });

  it('further decisions of the same seat in the same step use what is left of the delay', () => {
    const c = createTableClock({ seats: 2, at: 0 });
    c.handle({ type: 'decision', at: 0, seat: seat(1) });
    c.handle({ type: 'answered', at: 3 * SEC, seat: seat(1) });
    c.handle({ type: 'decision', at: 3 * SEC, seat: seat(1) }); // choosing targets, paying: the same period
    expect(delay(c, 1)).toBe(2 * SEC);
    c.handle({ type: 'answered', at: 4 * SEC, seat: seat(1) });
    c.handle({ type: 'decision', at: 4 * SEC, seat: seat(1) });
    expect(delay(c, 1)).toBe(1 * SEC);
    expect(bank(c, 1, 10 * SEC)).toBe(BANK - 5 * SEC);
  });

  it('between an answer and the next decision nobody\'s clock runs', () => {
    const c = createTableClock({ seats: 2, at: 0 });
    c.handle({ type: 'decision', at: 0, seat: seat(1) });
    c.handle({ type: 'answered', at: 1 * SEC, seat: seat(1) });
    expect(running(c)).toEqual([]);
    c.handle({ type: 'decision', at: 61 * SEC, seat: seat(1) });
    expect(delay(c, 1)).toBe(4 * SEC);
    expect(bank(c, 1)).toBe(BANK);
  });

  it('control passing from another player starts a new period with a fresh delay', () => {
    const c = createTableClock({ seats: 2, at: 0 });
    c.handle({ type: 'decision', at: 0, seat: seat(1) });
    c.handle({ type: 'answered', at: 10 * SEC, seat: seat(1) }); // A spent the delay and 5 s of bank
    c.handle({ type: 'decision', at: 10 * SEC, seat: seat(2) });
    expect(delay(c, 2)).toBe(5 * SEC);
    expect(running(c)).toEqual([2]);
    c.handle({ type: 'answered', at: 12 * SEC, seat: seat(2) });
    c.handle({ type: 'decision', at: 12 * SEC, seat: seat(1) });
    expect(delay(c, 1)).toBe(5 * SEC);
    expect(bank(c, 1)).toBe(BANK - 5 * SEC);
    expect(bank(c, 2)).toBe(BANK);
  });

  it('a new step for the same seat starts a new period', () => {
    const c = createTableClock({ seats: 2, at: 0 });
    c.handle({ type: 'decision', at: 0, seat: seat(1) });
    c.handle({ type: 'answered', at: 4 * SEC, seat: seat(1) });
    c.handle({ type: 'decision', at: 4 * SEC, seat: seat(1), newStep: true });
    expect(delay(c, 1)).toBe(5 * SEC);
    const before = c.readings()[0]!.period;
    c.handle({ type: 'answered', at: 5 * SEC, seat: seat(1) });
    c.handle({ type: 'decision', at: 5 * SEC, seat: seat(1) });
    expect(c.readings()[0]!.period).toBe(before);
  });

  it('the animation allowance: 150 ms per event of the change that started the period, at most 10 s', () => {
    const c = createTableClock({ seats: 2, at: 0 });
    c.handle({ type: 'decision', at: 0, seat: seat(1), events: 10 });
    expect(delay(c, 1)).toBe(5 * SEC + 10 * CLOCK_TIMING.animationPerEventMs);
    c.handle({ type: 'answered', at: 0, seat: seat(1) });
    c.handle({ type: 'decision', at: 0, seat: seat(2), events: 1_000 });
    expect(delay(c, 2)).toBe(5 * SEC + CLOCK_TIMING.animationMaxMs);
    // A continuing period gets no allowance: only the change that started it counts.
    c.handle({ type: 'answered', at: 1 * SEC, seat: seat(2) });
    c.handle({ type: 'decision', at: 1 * SEC, seat: seat(2), events: 50 });
    expect(delay(c, 2)).toBe(14 * SEC);
    c.handle({ type: 'decision', at: 1 * SEC, seat: seat(2), events: -5 });
    expect(delay(c, 2)).toBe(14 * SEC);
  });

  it('readings carry the bank, allowance, the delay left and the period number', () => {
    const c = createTableClock({ seats: 2, at: 0 });
    c.handle({ type: 'decision', at: 0, seat: seat(1) });
    c.handle({ type: 'answered', at: 7 * SEC, seat: seat(1) });
    c.handle({ type: 'decision', at: 7 * SEC, seat: seat(2) });
    expect(c.readings()).toEqual([
      { seat: 1, bankMs: BANK - 2 * SEC, dropMs: 5 * MIN, delayMs: 0, period: 1, actions: 1 },
      { seat: 2, bankMs: BANK, dropMs: 5 * MIN, delayMs: 5 * SEC, period: 2, actions: 0 },
    ]);
  });
});

describe('M13-3: time-out (CR 104.3a: a concession by the table\'s rule)', () => {
  it('the bank at 0 is a time-out at that exact instant; in 1v1 the clocks stop', () => {
    const c = createTableClock({ seats: 2, at: 1_000 });
    c.handle({ type: 'decision', at: 1_000, seat: seat(1) });
    const deadline = 1_000 + 5 * SEC + BANK;
    expect(c.nextDeadline()).toBe(deadline);
    expect(tick(c, deadline - 1)).toEqual([]);
    expect(tick(c, deadline)).toEqual([`timeout:1@${deadline}`]);
    expect(c.isOut(seat(1))).toBe(true);
    expect(c.isOver()).toBe(true);
    expect(c.nextDeadline()).toBeNull();
    expect(running(c)).toEqual([]);
  });

  it('a late tick reports the instant the bank reached 0, not the tick\'s', () => {
    const c = createTableClock({ seats: 2, at: 0 });
    c.handle({ type: 'decision', at: 0, seat: seat(2) });
    expect(tick(c, 5 * SEC + BANK + 3_000)).toEqual([`timeout:2@${5 * SEC + BANK}`]);
  });

  it('in a pod the game goes on: the timed-out seat is out, the others play on', () => {
    const c = createTableClock({ seats: 3, at: 0 });
    c.handle({ type: 'decision', at: 0, seat: seat(2) });
    const t = 5 * SEC + 20 * MIN;
    expect(runTo(c, t)).toEqual([`timeout:2@${t}`]);
    expect(c.isOver()).toBe(false);
    expect(running(c)).toEqual([]);
    expect(outs(c.handle({ type: 'decision', at: t, seat: seat(2) }))).toEqual([]);
    expect(c.handle({ type: 'decision', at: t, seat: seat(2) }).outcomes[0]).toMatchObject({ kind: 'ignored' });
    c.handle({ type: 'decision', at: t, seat: seat(3) });
    expect(running(c)).toEqual([3]);
    expect(delay(c, 3)).toBe(5 * SEC);
  });

  it('a seat out by the engine (Leave, an in-game concession) stops its clock; seatOut after the clock\'s own time-out changes nothing', () => {
    const c = createTableClock({ seats: 3, at: 0 });
    c.handle({ type: 'decision', at: 0, seat: seat(1) });
    c.handle({ type: 'seatOut', at: 1 * SEC, seat: seat(1) });
    expect(running(c)).toEqual([]);
    expect(c.isOver()).toBe(false);
    expect(c.handle({ type: 'seatOut', at: 1 * SEC, seat: seat(1) }).outcomes[0]).toMatchObject({ kind: 'ignored' });
    c.handle({ type: 'seatOut', at: 2 * SEC, seat: seat(2) });
    expect(c.isOver()).toBe(true);
  });

  it('gameOver stops every clock', () => {
    const c = createTableClock({ seats: 2, at: 0 });
    c.handle({ type: 'decision', at: 0, seat: seat(1) });
    c.handle({ type: 'gameOver', at: 1 * SEC });
    expect(c.nextDeadline()).toBeNull();
    expect(tick(c, 10 * 60 * MIN)).toEqual([]);
    expect(bank(c, 1)).toBe(BANK);
  });
});

describe('M13-3: the rope and the clock messages (design 5.1, 3.4)', () => {
  it('the rope shows once the delay is spent and turns urgent under 60 s of bank', () => {
    const c = createTableClock({ seats: 2, at: 0 });
    c.handle({ type: 'decision', at: 0, seat: seat(1), events: 0 });
    const v = c.view();
    expect(ropeFor(v, seat(1), 4_999)).toBeNull();
    expect(ropeFor(v, seat(1), 5_000)).toEqual({ bankMs: BANK, urgent: false });
    expect(ropeFor(v, seat(2), 6_000)).toBeNull();
    expect(ropeFor(v, seat(1), 5 * SEC + BANK - ROPE_URGENT_MS)).toEqual({ bankMs: ROPE_URGENT_MS, urgent: false });
    expect(ropeFor(v, seat(1), 5 * SEC + BANK - ROPE_URGENT_MS + 1)).toEqual({ bankMs: ROPE_URGENT_MS - 1, urgent: true });
    expect(clocksAt(v, 5 * SEC + BANK + 10 * SEC).seats[0]).toMatchObject({ bankMs: 0, delayMs: 0, rope: true, urgent: true });
  });

  it('the browser\'s projection equals the server\'s view at the same instant', () => {
    const c = createTableClock({ seats: 3, at: 0 });
    c.handle({ type: 'decision', at: 0, seat: seat(1) });
    c.handle({ type: 'disconnect', at: 2 * SEC, seat: seat(3) });
    const v = c.view();
    for (const t of [2 * SEC, 4 * SEC, 9 * SEC, 3 * MIN]) {
      const projected = clocksAt(v, t).seats.map(({ rope: _r, urgent: _u, ...rest }) => rest);
      expect(projected).toEqual(c.view(t).seats);
    }
  });

  it('`changed` says when to send `clock`: a clock starts or stops, never per second', () => {
    const c = createTableClock({ seats: 2, at: 0 });
    expect(c.handle({ type: 'decision', at: 0, seat: seat(1) }).changed).toBe(true);
    expect(c.handle({ type: 'tick', at: 3 * SEC }).changed).toBe(false);
    expect(c.handle({ type: 'tick', at: 9 * SEC }).changed).toBe(false); // the delay ran out: the browser counts that itself
    expect(c.handle({ type: 'answered', at: 10 * SEC, seat: seat(1) }).changed).toBe(true);
    expect(c.handle({ type: 'decision', at: 10 * SEC, seat: seat(2) }).changed).toBe(true);
    expect(c.handle({ type: 'vote', at: 10 * SEC, seat: seat(1), approve: true }).changed).toBe(false); // ignored
    expect(c.handle({ type: 'disconnect', at: 11 * SEC, seat: seat(1) }).changed).toBe(true);
  });
});

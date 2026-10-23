/**
 * M13-11: the page's reading of the hosted clocks (hosted/clocks.ts; hosted design 5.1). It is the same arithmetic as the server's own `clock/rope.ts`,
 * which `@openmtg/hosted/api` does not export yet: this test pins the two against each other over a table of clocks, so a change on either side fails here.
 */
import { describe, expect, it } from 'vitest';
import type { ClockView, SeatClock } from '@openmtg/hosted/api';
import { clocksAt as serverClocksAt, seatClockAt as serverSeatClockAt } from '../../../hosted/src/clock/rope';
import { clockOfSeat, clocksAt, clocksMoving, clockText, ROPE_URGENT_MS, seatClockAt } from '../../src/hosted/clocks';

const seat = (o: Partial<SeatClock> = {}): SeatClock => ({ seat: 1, bankMs: 900_000, running: false, delayMs: 0, dropMs: 300_000, dropRunning: false, ...o });

describe("the same arithmetic as the server's rope", () => {
  const clocks: SeatClock[] = [
    seat(),
    seat({ running: true, delayMs: 5000 }),
    seat({ running: true, delayMs: 0, bankMs: 61_000 }),
    seat({ running: true, delayMs: 2000, bankMs: 30_000 }),
    seat({ running: true, delayMs: 0, bankMs: 500 }),
    seat({ dropRunning: true, dropMs: 120_000 }),
    seat({ running: true, dropRunning: true, delayMs: 1000, bankMs: 70_000, dropMs: 10_000 }),
  ];
  const offsets = [0, 1, 999, 1000, 5000, 5001, 10_000, 59_999, 60_000, 400_000, 2_000_000];

  it('for every clock at every moment, seat by seat', () => {
    for (const c of clocks) for (const dt of offsets) expect(seatClockAt(c, 1000, 1000 + dt)).toEqual(serverSeatClockAt(c, 1000, 1000 + dt));
  });

  it('for a whole clock view, the abandonment time included, and not before it was sent', () => {
    const view: ClockView = { at: 50_000, seats: [seat({ running: true, delayMs: 3000 }), seat({ seat: 2, dropRunning: true })], abandonMs: 200_000 };
    for (const dt of [-5000, 0, 1000, 4000, 100_000, 300_000]) {
      const ours = clocksAt(view, 50_000 + dt);
      const theirs = serverClocksAt(view, 50_000 + dt);
      expect(ours.seats).toEqual(theirs.seats);
      expect(ours.abandonMs).toBe(theirs.abandonMs);
    }
  });
});

describe('reading a clock', () => {
  it('spends the free delay first, then the bank, and stops at 0; the rope shows once the delay is spent, urgent under a minute', () => {
    const c = seat({ running: true, delayMs: 5000, bankMs: 62_000 });
    expect(seatClockAt(c, 0, 4000)).toMatchObject({ delayMs: 1000, bankMs: 62_000, rope: false, urgent: false });
    expect(seatClockAt(c, 0, 6000)).toMatchObject({ delayMs: 0, bankMs: 61_000, rope: true, urgent: false });
    expect(seatClockAt(c, 0, 8000)).toMatchObject({ bankMs: 59_000, rope: true, urgent: true });
    expect(seatClockAt(c, 0, 999_999)).toMatchObject({ bankMs: 0, rope: true, urgent: true });
    expect(ROPE_URGENT_MS).toBe(60_000);
  });

  it('a clock that does not run does not move, and the drop clock moves only while it runs', () => {
    expect(seatClockAt(seat({ bankMs: 5000 }), 0, 60_000)).toMatchObject({ bankMs: 5000, rope: false });
    expect(seatClockAt(seat({ dropMs: 90_000 }), 0, 60_000).dropMs).toBe(90_000);
    expect(seatClockAt(seat({ dropMs: 90_000, dropRunning: true }), 0, 60_000).dropMs).toBe(30_000);
  });

  it("finds a seat's clock, and knows when a timer is needed", () => {
    const view: ClockView = { at: 0, seats: [seat(), seat({ seat: 2 })] };
    expect(clockOfSeat(clocksAt(view, 0), 2)?.seat).toBe(2);
    expect(clockOfSeat(clocksAt(view, 0), 3)).toBeNull();
    expect(clockOfSeat(null, 1)).toBeNull();
    expect(clocksMoving(view)).toBe(false);
    expect(clocksMoving({ ...view, seats: [seat({ running: true })] })).toBe(true);
    expect(clocksMoving({ ...view, seats: [seat({ dropRunning: true })] })).toBe(true);
    expect(clocksMoving({ ...view, abandonMs: 1000 })).toBe(true);
    expect(clocksMoving(null)).toBe(false);
  });

  it('shows m:ss, rounded up to the next second, and h:mm:ss from an hour', () => {
    expect(clockText(0)).toBe('0:00');
    expect(clockText(-5)).toBe('0:00');
    expect(clockText(1)).toBe('0:01');
    expect(clockText(59_000)).toBe('0:59');
    expect(clockText(872_100)).toBe('14:33');
    expect(clockText(900_000)).toBe('15:00');
    expect(clockText(3_600_000)).toBe('1:00:00');
    expect(clockText(3_725_000)).toBe('1:02:05');
  });
});

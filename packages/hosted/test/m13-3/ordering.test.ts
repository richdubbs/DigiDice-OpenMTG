/**
 * Same-instant ordering (design 4.4): (1) connection changes, (2) the abandonment check, (3) drop forfeits, (4) bank time-outs, each in turn order from
 * the active seat, (5) the per-game caps (design 2.2: wall-clock time, 2 hours 1v1, 4 in a pod; outages not counted). Also: inputs at an instant come
 * before that instant's expiries; expiries before an input come before it; the results do not depend on when the timer fires.
 */
import { describe, expect, it } from 'vitest';
import { GAME_LIMITS, type SeatNumber } from '@openmtg/hosted';
import { createTableClock, type ClockEvent, type TableClock } from '../../src/clock';
import { brief, drop, HOUR, MIN, outs, runTo, SEC, seat, tick } from './helpers';

const BANK = 15 * MIN;
const DROP = 5 * MIN;

describe('M13-3: (1) connection changes come first', () => {
  it('a player who comes back at the instant their drop clock would expire keeps the seat', () => {
    const c = createTableClock({ seats: 2, at: 0 });
    c.handle({ type: 'disconnect', at: 0, seat: seat(1) });
    expect(c.nextDeadline()).toBe(DROP);
    expect(outs(c.handle({ type: 'reconnect', at: DROP, seat: seat(1) }))).toEqual([]);
    expect(tick(c, DROP)).toEqual([]);
    expect(c.isOut(seat(1))).toBe(false);
    expect(drop(c, 1)).toBe(0);
    // With nothing left of the allowance, the next drop is a forfeit at once.
    c.handle({ type: 'disconnect', at: DROP + 1 * MIN, seat: seat(1) });
    expect(tick(c, DROP + 1 * MIN)).toEqual([`forfeit:1@${DROP + 1 * MIN}`]);
  });

  it('(1)+(2) the last connected player drops at the instant another\'s drop clock would expire: no forfeit, abandonment', () => {
    const c = createTableClock({ seats: 2, at: 0 });
    c.handle({ type: 'disconnect', at: 0, seat: seat(1) });
    expect(outs(c.handle({ type: 'disconnect', at: DROP, seat: seat(2) }))).toEqual([`abandoning@${DROP}->${DROP + 5 * MIN}`]);
    expect(tick(c, DROP)).toEqual([]);
    expect(c.isOut(seat(1))).toBe(false);
    // B returns first: A's drop clock resumes where it paused (at 0), so A forfeits then.
    c.handle({ type: 'reconnect', at: DROP + 1 * MIN, seat: seat(2) });
    expect(tick(c, DROP + 1 * MIN)).toEqual([`forfeit:1@${DROP + 1 * MIN}`]);
  });

  it('(1)+(2) ... and if A returns first, A keeps the seat and B\'s drop clock runs', () => {
    const c = createTableClock({ seats: 2, at: 0 });
    c.handle({ type: 'disconnect', at: 0, seat: seat(1) });
    c.handle({ type: 'disconnect', at: DROP, seat: seat(2) });
    c.handle({ type: 'reconnect', at: DROP + 1 * MIN, seat: seat(1) });
    expect(runTo(c, DROP + 1 * MIN + DROP)).toEqual([`forfeit:2@${DROP + 1 * MIN + DROP}`]);
  });

  it('a stale tick (stamped before the clock\'s time) does not process the expiries at the current instant', () => {
    const c = createTableClock({ seats: 2, at: 0 });
    c.handle({ type: 'disconnect', at: 0, seat: seat(1) });
    c.handle({ type: 'decision', at: DROP, seat: seat(2) }); // the clock is now at DROP, seat 1's allowance is at 0 (not processed yet)
    expect(tick(c, DROP - 1 * SEC)).toEqual([]);
    expect(c.isOut(seat(1))).toBe(false);
    // So seat 1, coming back at that same instant, keeps the seat (connection changes first).
    c.handle({ type: 'reconnect', at: DROP, seat: seat(1) });
    expect(tick(c, DROP)).toEqual([]);
    expect(c.isOut(seat(1))).toBe(false);
  });

  it('an action at the exact instant the bank reaches 0 is in time', () => {
    const c = createTableClock({ seats: 2, at: 0 });
    c.handle({ type: 'decision', at: 0, seat: seat(1) });
    const d = 5 * SEC + BANK;
    expect(outs(c.advance(d))).toEqual([]);
    expect(c.isOut(seat(1))).toBe(false);
    c.handle({ type: 'answered', at: d, seat: seat(1) });
    c.handle({ type: 'decision', at: d, seat: seat(2) });
    expect(tick(c, d)).toEqual([]);
    expect(c.isOut(seat(1))).toBe(false);
  });

  it('an action after a missed deadline: the time-out is processed first (advance), the seat is out and its action is refused', () => {
    const c = createTableClock({ seats: 2, at: 0 });
    c.handle({ type: 'decision', at: 0, seat: seat(1) });
    const d = 5 * SEC + BANK;
    expect(outs(c.advance(d + 1))).toEqual([`timeout:1@${d}`]);
    expect(c.isOut(seat(1))).toBe(true);
    expect(c.handle({ type: 'answered', at: d + 1, seat: seat(1) }).outcomes[0]).toMatchObject({ kind: 'ignored' });
  });
});

describe('M13-3: (3) drop forfeits before (4) bank time-outs, in turn order from the active seat', () => {
  it('1v1: A\'s bank and B\'s drop clock run out at the same instant: B forfeits; A does not time out', () => {
    const c = createTableClock({ seats: 2, at: 0 });
    c.handle({ type: 'decision', at: 0, seat: seat(1) });
    const d = 5 * SEC + BANK;
    c.handle({ type: 'disconnect', at: d - DROP, seat: seat(2) });
    expect(tick(c, d)).toEqual([`forfeit:2@${d}`]);
    expect(c.isOut(seat(1))).toBe(false);
    expect(c.isOver()).toBe(true);
  });

  for (const [active, order] of [[1, [2, 4]], [3, [4, 2]], [4, [4, 2]], [2, [2, 4]]] as const) {
    it(`a pod: two drop clocks run out at once, active seat ${active}: forfeits in the order ${order.join(', ')}`, () => {
      const c = createTableClock({ seats: 4, at: 0 });
      c.handle({ type: 'decision', at: 0, seat: seat(1), active: seat(active) });
      c.handle({ type: 'disconnect', at: 0, seat: seat(2) });
      c.handle({ type: 'disconnect', at: 0, seat: seat(4) });
      expect(tick(c, DROP)).toEqual(order.map((s) => `forfeit:${s}@${DROP}`));
      expect(c.isOver()).toBe(false);
    });
  }

  it('a pod: three approvers\' banks run out at once, active seat 3: time-outs 3, 4, then 2 ends the game (seat 1 is left)', () => {
    const c = createTableClock({ seats: 4, at: 0 });
    c.handle({ type: 'decision', at: 0, seat: seat(1), active: seat(3) });
    c.handle({ type: 'propose', at: 0, seat: seat(1) });
    const d = 5 * SEC + 20 * MIN;
    expect(tick(c, d)).toEqual([`timeout:3@${d}`, `timeout:4@${d}`, `timeout:2@${d}`]);
    expect(c.isOver()).toBe(true);
    expect(c.isOut(seat(1))).toBe(false);
  });

  it('a pod: a drop forfeit and a bank time-out at once: both, the forfeit first, each its own record', () => {
    const c = createTableClock({ seats: 3, at: 0 });
    c.handle({ type: 'decision', at: 0, seat: seat(1), active: seat(1) });
    const d = 5 * SEC + 20 * MIN;
    c.handle({ type: 'disconnect', at: d - DROP, seat: seat(3) });
    expect(tick(c, d)).toEqual([`forfeit:3@${d}`, `timeout:1@${d}`]);
    expect(c.isOver()).toBe(true);
  });
});

describe('M13-3: (5) the per-game caps by time (design 2.2)', () => {
  it('1v1: limitWarning at 90% of 2 hours (once), void ("limit") at 2 hours', () => {
    const c = createTableClock({ seats: 2, at: 0 });
    expect(GAME_LIMITS.wallClock1v1Ms).toBe(2 * HOUR);
    expect(runTo(c, 3 * HOUR)).toEqual([`limitWarning@${0.9 * 2 * HOUR}`, `void:limit@${2 * HOUR}`]);
    expect(c.isOver()).toBe(true);
  });

  it('a pod: 4 hours', () => {
    const c = createTableClock({ seats: 4, at: 1_000 });
    expect(runTo(c, 5 * HOUR)).toEqual([`limitWarning@${1_000 + 0.9 * 4 * HOUR}`, `void:limit@${1_000 + 4 * HOUR}`]);
  });

  it('(4) before (5), 1v1: a time-out at the instant of the cap ends the game by the time-out', () => {
    const c = createTableClock({ seats: 2, at: 0 });
    c.handle({ type: 'decision', at: 2 * HOUR - 5 * SEC - BANK, seat: seat(1) });
    expect(runTo(c, 3 * HOUR)).toEqual([`limitWarning@${0.9 * 2 * HOUR}`, `timeout:1@${2 * HOUR}`]);
  });

  it('(4) before (5), a pod: the time-out is recorded, then the game is void by the cap', () => {
    const c = createTableClock({ seats: 3, at: 0 });
    // The warning (at 3:36) comes before the decision (at 3:39:55): the decision's own step reports it.
    expect(outs(c.handle({ type: 'decision', at: 4 * HOUR - 5 * SEC - 20 * MIN, seat: seat(2) }))).toEqual([`limitWarning@${0.9 * 4 * HOUR}`]);
    expect(runTo(c, 5 * HOUR)).toEqual([`timeout:2@${4 * HOUR}`, `void:limit@${4 * HOUR}`]);
  });

  it('(2) before (5): abandonment ending at the instant of the cap voids the game as abandoned', () => {
    const c = createTableClock({ seats: 2, at: 0 });
    expect(runTo(c, 2 * HOUR - 5 * MIN)).toEqual([`limitWarning@${0.9 * 2 * HOUR}`]);
    c.handle({ type: 'disconnect', at: 2 * HOUR - 5 * MIN, seat: seat(1) });
    c.handle({ type: 'disconnect', at: 2 * HOUR - 5 * MIN, seat: seat(2) });
    expect(runTo(c, 3 * HOUR)).toEqual([`void:abandoned@${2 * HOUR}`]);
  });

  it('(3) before (5): a drop forfeit at the instant of the cap ends a 1v1 game by the forfeit', () => {
    const c = createTableClock({ seats: 2, at: 0 });
    expect(outs(c.handle({ type: 'disconnect', at: 2 * HOUR - DROP, seat: seat(2) }))).toEqual([`limitWarning@${0.9 * 2 * HOUR}`]);
    expect(runTo(c, 3 * HOUR)).toEqual([`forfeit:2@${2 * HOUR}`]);
  });
});

/** A small deterministic generator (mulberry32) for scripted event sequences. */
function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function script(seed: number, seats: number): ClockEvent[] {
  const r = rng(seed);
  const pick = (): SeatNumber => (1 + Math.floor(r() * seats)) as SeatNumber;
  const events: ClockEvent[] = [];
  let at = 0;
  for (let i = 0; i < 400; i++) {
    at += r() < 0.03 ? 6 * MIN : Math.floor(r() * 20) * SEC; // many ties on whole seconds; now and then a long silence
    const x = r();
    const s = pick();
    if (x < 0.3) events.push({ type: 'decision', at, seat: s, newStep: r() < 0.3, events: Math.floor(r() * 30), active: pick() });
    else if (x < 0.45) events.push({ type: 'answered', at, seat: s });
    else if (x < 0.5) events.push({ type: 'cancel', at, seat: s });
    else if (x < 0.58) events.push({ type: 'propose', at, seat: s });
    else if (x < 0.68) events.push({ type: 'vote', at, seat: s, approve: r() < 0.5 });
    else if (x < 0.7) events.push({ type: 'withdraw', at, seat: s });
    else if (x < 0.82) events.push({ type: 'disconnect', at, seat: s });
    else if (x < 0.97) events.push({ type: 'reconnect', at, seat: s });
    else events.push({ type: 'seatOut', at, seat: s });
  }
  return events;
}

/** Plays a script; `wake` decides whether the timer fires at each deadline before an input (strictly before it) or only inputs drive the clock. */
function play(events: ClockEvent[], seats: number, wake: boolean, long: boolean): { log: string[]; views: string[] } {
  const settings = long ? { bankMs: 60 * MIN, delayMs: 5 * SEC, dropMs: 30 * MIN } : { bankMs: 2 * MIN, delayMs: 5 * SEC, dropMs: 1 * MIN };
  const c: TableClock = createTableClock({ seats, at: 0, settings });
  const log: string[] = [];
  const views: string[] = [];
  for (const e of events) {
    if (wake) {
      for (let d = c.nextDeadline(); d !== null && d < e.at; d = c.nextDeadline()) log.push(...brief(c.handle({ type: 'tick', at: d }).outcomes));
    }
    log.push(...brief(c.handle(e).outcomes));
    views.push(JSON.stringify(c.view()));
  }
  log.push(...brief(c.handle({ type: 'tick', at: 1_000 * HOUR }).outcomes));
  return { log, views };
}

describe('M13-3: deterministic and independent of when the timer fires', () => {
  it('the same events give the same outcomes and views, with or without timer wake-ups (40 scripts, 2-4 seats)', () => {
    const seen = new Set<string>();
    for (let seed = 1; seed <= 40; seed++) {
      const seats = 2 + (seed % 3);
      const events = script(seed, seats);
      const long = seed % 2 === 0; // short clocks end games by time-outs and forfeits; long ones reach abandonment and the cap
      const a = play(events, seats, true, long);
      const b = play(events, seats, true, long);
      const c = play(events, seats, false, long);
      expect(a).toEqual(b);
      expect(c).toEqual(a);
      for (const l of a.log) seen.add(l.replace(/[:@].*$/, ''));
    }
    // The scripts exercise every kind of outcome.
    for (const k of ['timeout', 'forfeit', 'void', 'abandoning', 'opened', 'closed', 'refused']) expect(seen.has(k), k).toBe(true);
  });

  it('a game always ends within the wall-clock cap, whatever the inputs', () => {
    for (let seed = 10; seed < 20; seed++) {
      const seats = 2 + (seed % 3);
      const c = createTableClock({ seats, at: 0 });
      for (const e of script(seed, seats)) c.handle(e);
      c.handle({ type: 'tick', at: 4 * HOUR });
      expect(c.isOver()).toBe(true);
      expect(c.nextDeadline()).toBeNull();
    }
  });
});

/**
 * Design 5.3, 4.4 (owner answer 8, M12 Q5; review 6): the drop clock (5 minutes in total per game, then a concession, CR 104.3a), abandonment (nobody
 * still in the game connected: drop clocks pause, the game is void after 5 minutes), pods, and recovery after an outage (design 2.3).
 */
import { describe, expect, it } from 'vitest';
import { HOSTED_TIMING } from '@openmtg/hosted';
import { CLOCK_TIMING, createTableClock, recoverTableClock } from '../../src/clock';
import { bank, delay, drop, dropRunning, HOUR, MIN, outs, running, runTo, SEC, seat, tick } from './helpers';

const BANK = 15 * MIN;
const DROP = 5 * MIN;
const ABANDON = HOSTED_TIMING.abandonMs;

describe('M13-3: the drop clock (design 5.3)', () => {
  it('a disconnected deciding seat: its bank stops and its drop clock runs; back, the bank resumes', () => {
    const c = createTableClock({ seats: 2, at: 0 });
    c.handle({ type: 'decision', at: 0, seat: seat(1) });
    c.handle({ type: 'disconnect', at: 2 * SEC, seat: seat(1) });
    expect(running(c)).toEqual([]);
    expect(dropRunning(c)).toEqual([1]);
    expect(drop(c, 1, 62 * SEC)).toBe(DROP - 60 * SEC);
    c.handle({ type: 'reconnect', at: 62 * SEC, seat: seat(1) });
    expect(running(c)).toEqual([1]);
    expect(dropRunning(c)).toEqual([]);
    expect(delay(c, 1)).toBe(3 * SEC);
    expect(bank(c, 1)).toBe(BANK);
  });

  it('the allowance is 5 minutes in total per game, across drops; at 0 the seat forfeits (cause disconnect)', () => {
    const c = createTableClock({ seats: 2, at: 0 });
    c.handle({ type: 'decision', at: 0, seat: seat(2) });
    c.handle({ type: 'disconnect', at: 0, seat: seat(1) });
    c.handle({ type: 'reconnect', at: 2 * MIN, seat: seat(1) });
    c.handle({ type: 'disconnect', at: 3 * MIN, seat: seat(1) });
    c.handle({ type: 'reconnect', at: 5 * MIN, seat: seat(1) });
    expect(drop(c, 1)).toBe(1 * MIN);
    c.handle({ type: 'disconnect', at: 6 * MIN, seat: seat(1) });
    expect(c.nextDeadline()).toBe(7 * MIN);
    expect(runTo(c, 8 * MIN)).toEqual([`forfeit:1@${7 * MIN}`]);
    expect(c.isOver()).toBe(true);
  });

  it('a seat that does not have to decide still uses its allowance while away', () => {
    const c = createTableClock({ seats: 2, at: 0 });
    c.handle({ type: 'decision', at: 0, seat: seat(1) });
    c.handle({ type: 'disconnect', at: 0, seat: seat(2) });
    expect(dropRunning(c)).toEqual([2]);
    expect(runTo(c, DROP)).toEqual([`forfeit:2@${DROP}`]);
  });

  it('a pod: the game goes on after a forfeit; several drop clocks run at once', () => {
    const c = createTableClock({ seats: 4, at: 0 });
    c.handle({ type: 'decision', at: 0, seat: seat(1) });
    c.handle({ type: 'disconnect', at: 0, seat: seat(2) });
    c.handle({ type: 'disconnect', at: 1 * MIN, seat: seat(3) });
    expect(dropRunning(c)).toEqual([2, 3]);
    expect(runTo(c, DROP)).toEqual([`forfeit:2@${DROP}`]);
    expect(c.isOver()).toBe(false);
    expect(dropRunning(c)).toEqual([3]);
    expect(runTo(c, DROP + 1 * MIN)).toEqual([`forfeit:3@${DROP + 1 * MIN}`]);
    expect(c.isOver()).toBe(false);
    expect(running(c)).toEqual([1]);
  });

  it('reconnect and disconnect twice in a row are ignored', () => {
    const c = createTableClock({ seats: 2, at: 0 });
    expect(c.handle({ type: 'reconnect', at: 0, seat: seat(1) }).outcomes[0]).toMatchObject({ kind: 'ignored' });
    c.handle({ type: 'disconnect', at: 0, seat: seat(1) });
    expect(c.handle({ type: 'disconnect', at: 0, seat: seat(1) }).outcomes[0]).toMatchObject({ kind: 'ignored' });
    expect(c.handle({ type: 'disconnect', at: 0, seat: seat(7 as never) }).outcomes[0]).toMatchObject({ kind: 'ignored' });
  });
});

describe('M13-3: abandonment (design 4.4, review 6): nobody wins by being the last one to disappear', () => {
  it('A drops at t0, B at t0+10 s: nobody wins; the game is void at t0+10 s+5:00', () => {
    const t0 = 50_000;
    const c = createTableClock({ seats: 2, at: 0 });
    c.handle({ type: 'decision', at: 0, seat: seat(2) });
    expect(outs(c.handle({ type: 'disconnect', at: t0, seat: seat(1) }))).toEqual([]);
    expect(outs(c.handle({ type: 'disconnect', at: t0 + 10 * SEC, seat: seat(2) }))).toEqual([`abandoning@${t0 + 10 * SEC}->${t0 + 10 * SEC + ABANDON}`]);
    // Every drop clock pauses: A's at 4:50, B's at 5:00.
    expect(dropRunning(c)).toEqual([]);
    expect(c.view().abandonMs).toBe(ABANDON);
    expect(drop(c, 1, t0 + 4 * MIN)).toBe(DROP - 10 * SEC);
    expect(drop(c, 2, t0 + 4 * MIN)).toBe(DROP);
    expect(c.view(t0 + 4 * MIN).abandonMs).toBe(ABANDON - 4 * MIN + 10 * SEC);
    const end = t0 + 10 * SEC + ABANDON;
    expect(c.nextDeadline()).toBe(end);
    expect(runTo(c, end - 1)).toEqual([]);
    expect(runTo(c, end + 10 * MIN)).toEqual([`void:abandoned@${end}`]);
    expect(c.isOver()).toBe(true);
    expect(c.isOut(seat(1))).toBe(false);
    expect(c.isOut(seat(2))).toBe(false);
  });

  it('a seat that comes back stops the abandonment timer; the others\' drop clocks resume where they paused', () => {
    const c = createTableClock({ seats: 2, at: 0 });
    c.handle({ type: 'disconnect', at: 0, seat: seat(1) });
    c.handle({ type: 'disconnect', at: 10 * SEC, seat: seat(2) });
    c.handle({ type: 'reconnect', at: 10 * SEC + 4 * MIN, seat: seat(1) });
    expect(c.view().abandonMs).toBeUndefined();
    expect(drop(c, 1)).toBe(DROP - 10 * SEC); // A's paused and stopped with A back
    expect(dropRunning(c)).toEqual([2]);
    expect(drop(c, 2)).toBe(DROP);
    const t = 10 * SEC + 4 * MIN + DROP;
    expect(runTo(c, t)).toEqual([`forfeit:2@${t}`]);
  });

  it('everyone away again restarts a full abandonment timer', () => {
    const c = createTableClock({ seats: 2, at: 0 });
    c.handle({ type: 'disconnect', at: 0, seat: seat(1) });
    c.handle({ type: 'disconnect', at: 0, seat: seat(2) });
    c.handle({ type: 'reconnect', at: 4 * MIN, seat: seat(2) });
    expect(outs(c.handle({ type: 'disconnect', at: 4 * MIN + 1, seat: seat(2) }))).toEqual([`abandoning@${4 * MIN + 1}->${4 * MIN + 1 + ABANDON}`]);
  });

  it('a pod of 4: drop clocks run while one seat is connected; when the last connected seat drops, all pause and the game is void', () => {
    const c = createTableClock({ seats: 4, at: 0 });
    c.handle({ type: 'decision', at: 0, seat: seat(4) });
    c.handle({ type: 'disconnect', at: 0, seat: seat(1) });
    c.handle({ type: 'disconnect', at: 1 * MIN, seat: seat(2) });
    c.handle({ type: 'disconnect', at: 2 * MIN, seat: seat(3) });
    expect(dropRunning(c)).toEqual([1, 2, 3]);
    c.handle({ type: 'disconnect', at: 3 * MIN, seat: seat(4) });
    expect(dropRunning(c)).toEqual([]);
    expect(running(c)).toEqual([]);
    expect(c.view().seats.map((s) => s.dropMs)).toEqual([2 * MIN, 3 * MIN, 4 * MIN, 5 * MIN]);
    expect(runTo(c, 3 * MIN + ABANDON)).toEqual([`void:abandoned@${3 * MIN + ABANDON}`]);
  });

  it('a pod: the only connected player leaves while the others are away: the game is not won by the absent, it is abandoned', () => {
    const c = createTableClock({ seats: 3, at: 0 });
    c.handle({ type: 'disconnect', at: 0, seat: seat(1) });
    c.handle({ type: 'disconnect', at: 0, seat: seat(2) });
    expect(outs(c.handle({ type: 'seatOut', at: 1 * MIN, seat: seat(3) }))).toEqual([`abandoning@${1 * MIN}->${1 * MIN + ABANDON}`]);
    expect(runTo(c, 1 * MIN + ABANDON)).toEqual([`void:abandoned@${1 * MIN + ABANDON}`]);
  });

  it('a pod: the only connected player times out while the others are away: abandonment, no forfeit', () => {
    const c = createTableClock({ seats: 3, at: 0 });
    c.handle({ type: 'decision', at: 0, seat: seat(3) });
    const t = 5 * SEC + 20 * MIN;
    c.handle({ type: 'disconnect', at: t - 1 * MIN, seat: seat(1) });
    c.handle({ type: 'disconnect', at: t - 1 * MIN, seat: seat(2) });
    expect(runTo(c, t + ABANDON)).toEqual([`timeout:3@${t}`, `abandoning@${t}->${t + ABANDON}`, `void:abandoned@${t + ABANDON}`]);
    expect(c.isOut(seat(1))).toBe(false);
    expect(c.isOut(seat(2))).toBe(false);
  });
});

describe('M13-3: recovery after an outage (design 2.3): charged to nobody', () => {
  function midGame() {
    const c = createTableClock({ seats: 2, at: 0 });
    c.handle({ type: 'decision', at: 0, seat: seat(1) });
    c.handle({ type: 'answered', at: 65 * SEC, seat: seat(1) });
    c.handle({ type: 'decision', at: 65 * SEC, seat: seat(2) });
    c.handle({ type: 'disconnect', at: 66 * SEC, seat: seat(1) });
    c.handle({ type: 'reconnect', at: 126 * SEC, seat: seat(1) }); // 1 minute of A's allowance used
    c.handle({ type: 'answered', at: 128 * SEC, seat: seat(2) });
    c.handle({ type: 'decision', at: 128 * SEC, seat: seat(1) });
    c.handle({ type: 'answered', at: 130 * SEC, seat: seat(1) });
    c.handle({ type: 'decision', at: 130 * SEC, seat: seat(1) }); // A has 3 s of its delay left
    return c;
  }

  it('the clocks come back from the last record; the outage costs nobody bank, allowance or wall-clock time', () => {
    const live = midGame();
    const readings = live.readings();
    const back = 130 * SEC + 1 * HOUR;
    const c = recoverTableClock({ seats: 2, at: back, record: live.logFields(), controller: seat(1) });
    expect(c.elapsed).toBe(130 * SEC);
    expect(c.readings()).toEqual(readings);
    expect(bank(c, 1)).toBe(BANK - 60 * SEC);
    expect(bank(c, 2)).toBe(BANK - 58 * SEC);
    // Every seat starts away; nobody connected: the abandonment timer runs from the return of the server.
    expect(c.view().abandonMs).toBe(ABANDON);
    expect(dropRunning(c)).toEqual([]);
    expect(c.nextDeadline()).toBe(back + ABANDON);
  });

  it('every seat gets a fresh 5-minute reconnect window before its own allowance; the deciding seat goes on with its period', () => {
    const live = midGame();
    const back = 10 * HOUR;
    const c = recoverTableClock({ seats: 2, at: back, record: live.logFields(), controller: seat(1) });
    c.handle({ type: 'reconnect', at: back + 1 * MIN, seat: seat(1) });
    expect(running(c)).toEqual([1]);
    expect(delay(c, 1)).toBe(3 * SEC); // no new delay
    expect(dropRunning(c)).toEqual([2]);
    expect(drop(c, 2)).toBe(CLOCK_TIMING.reconnectWindowMs + DROP);
    // A plays on (connected); B never returns: the window, then all of B's own allowance.
    c.handle({ type: 'answered', at: back + 1 * MIN + 1 * SEC, seat: seat(1) });
    const forfeitAt = back + 1 * MIN + CLOCK_TIMING.reconnectWindowMs + DROP;
    expect(runTo(c, forfeitAt)).toEqual([`forfeit:2@${forfeitAt}`]);
  });

  it('the reconnect window ends at the seat\'s first reconnect: a later drop uses only the 5-minute allowance (5 minutes TOTAL per game)', () => {
    const live = midGame();
    const back = 10 * HOUR;
    const c = recoverTableClock({ seats: 2, at: back, record: live.logFields(), controller: seat(1) });
    c.handle({ type: 'reconnect', at: back + 1 * SEC, seat: seat(1) });
    c.handle({ type: 'answered', at: back + 1 * SEC, seat: seat(1) }); // nobody decides for the hour: only the drop clock matters
    c.handle({ type: 'reconnect', at: back + 2 * SEC, seat: seat(2) });
    expect(drop(c, 1)).toBe(DROP - 1 * MIN); // the minute seat 1 used before the outage stays used
    expect(drop(c, 2)).toBe(DROP);
    c.handle({ type: 'disconnect', at: back + 1 * HOUR, seat: seat(1) });
    expect(drop(c, 1)).toBe(DROP - 1 * MIN);
    const t = back + 1 * HOUR + DROP - 1 * MIN;
    expect(runTo(c, t)).toEqual([`forfeit:1@${t}`]);
  });

  it('the log fields carry the wall-clock time used: a recovery from them resumes the count (no outage counted)', () => {
    const live = midGame();
    expect(live.logFields()).toEqual({ clocks: live.readings(), elapsedMs: 130 * SEC });
    const c = recoverTableClock({ seats: 2, at: 50 * HOUR, record: live.logFields(), controller: seat(1) });
    expect(c.elapsed).toBe(130 * SEC);
  });

  it('a recovered table where nobody returns is void after the abandonment time', () => {
    const live = midGame();
    const c = recoverTableClock({ seats: 2, at: 5 * HOUR, record: live.logFields(), controller: seat(1) });
    expect(runTo(c, 5 * HOUR + ABANDON)).toEqual([`void:abandoned@${5 * HOUR + ABANDON}`]);
  });

  it('seats already out stay out; a recovered table with one seat left is over', () => {
    const c = recoverTableClock({ seats: 3, at: 0, record: { clocks: [], elapsedMs: 0 }, controller: seat(2), out: [seat(1)] });
    expect(c.isOut(seat(1))).toBe(true);
    expect(c.isOver()).toBe(false);
    const d = recoverTableClock({ seats: 2, at: 0, record: { clocks: [], elapsedMs: 0 }, controller: null, out: [seat(1)] });
    expect(d.isOver()).toBe(true);
    expect(d.nextDeadline()).toBeNull();
  });

  it('a recovered table resumes the wall-clock count: the cap is reached after the game time left, not counting the outage', () => {
    const c = recoverTableClock({ seats: 2, at: 100 * HOUR, record: { clocks: [], elapsedMs: 2 * HOUR - 1 * MIN }, controller: null });
    c.handle({ type: 'reconnect', at: 100 * HOUR, seat: seat(1) });
    c.handle({ type: 'reconnect', at: 100 * HOUR, seat: seat(2) });
    expect(tick(c, 100 * HOUR + 1 * MIN)).toEqual([`void:limit@${100 * HOUR + 1 * MIN}`]);
  });
});

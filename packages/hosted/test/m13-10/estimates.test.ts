/**
 * M13-10: positions and estimates (design 4.6, 3.4 `queueStatus`): the position, the units ahead, the estimated wait from the units freed in the last 10
 * minutes, and the `position` events (only on a change, at most once per 5 s per start).
 */
import { describe, expect, it } from 'vitest';
import { estimateWaitMs, FreedWindow } from '../../src/admission';
import { MIN, Rig, SEC, waitingOf } from './helpers';

/** Everything waits (the CPU is high), so freed units never admit anyone: only the estimate moves. */
const busy = () => {
  const r = new Rig();
  r.sig.set({ cpu: 0.9, runningUnits: 100 });
  return r;
};

describe('M13-10: positions', () => {
  it('a start is told its position and the units strictly ahead of it (its own not included); no estimate before anything has freed', () => {
    const r = busy();
    expect(waitingOf(r.start('A'))).toEqual({ position: 1, unitsAhead: 0, estimatedWaitMs: null });
    expect(waitingOf(r.start('B', { seats: 4 }))).toEqual({ position: 2, unitsAhead: 1, estimatedWaitMs: null });
    expect(waitingOf(r.start('C', { seats: 3 }))).toEqual({ position: 3, unitsAhead: 6, estimatedWaitMs: null });
    expect(waitingOf(r.start('D'))).toEqual({ position: 4, unitsAhead: 10, estimatedWaitMs: null });
    expect(r.adm.lookup('D', r.now)).toEqual({ position: 4, unitsAhead: 10, estimatedWaitMs: null });
    expect(r.adm.lookup('unknown', r.now)).toBeNull();
  });
});

describe('M13-10: the estimate', () => {
  it('is the units ahead plus its own, over the rate at which units freed in the last 10 minutes', () => {
    const r = busy();
    r.start('A');
    r.start('B', { seats: 4 });
    r.start('C');
    // six units freed (a pod's five and a 1v1 game's one)
    r.end(5);
    r.end(1);
    // the first minute of the process: the rate is taken over one minute, so 7 units (6 ahead and its own) take 7/6 of a minute
    expect(r.adm.lookup('C', r.now)).toEqual({ position: 3, unitsAhead: 6, estimatedWaitMs: 70_000 });
    expect(r.adm.lookup('A', r.now)).toEqual({ position: 1, unitsAhead: 0, estimatedWaitMs: 10_000 });
    expect(estimateWaitMs(7, 6, MIN)).toBe(70_000);
  });

  it('counts only the last 10 minutes: older frees drop out, and with none there is no estimate', () => {
    const r = busy();
    r.start('A');
    r.end(6);
    expect(r.adm.lookup('A', r.now)?.estimatedWaitMs).toBe(10_000);
    r.go(10 * MIN - 1);
    expect(r.adm.lookup('A', r.now)?.estimatedWaitMs).not.toBeNull();
    r.go(1);
    expect(r.adm.lookup('A', r.now)?.estimatedWaitMs).toBeNull();
    // the window is the full ten minutes by now: two units freed make 1 unit's wait 1/2 of ten minutes
    r.end(2);
    expect(r.adm.lookup('A', r.now)?.estimatedWaitMs).toBe(5 * MIN);
  });

  it('in the first minutes of a process the rate is taken over the time since admission was first used, never under a minute', () => {
    const r = busy();
    r.start('A');
    r.go(2 * MIN);
    r.end(4);
    // two minutes in, four units freed: one unit takes a quarter of two minutes
    expect(r.adm.lookup('A', r.now)?.estimatedWaitMs).toBe(30_000);

    const fresh = busy();
    fresh.start('A');
    fresh.go(10 * SEC);
    fresh.end(4);
    // ten seconds in: the span is a minute (a few units freed in ten seconds do not promise a quarter of ten seconds)
    expect(fresh.adm.lookup('A', fresh.now)?.estimatedWaitMs).toBe(15_000);
  });

  it('a pod\'s units count: a start behind a pod waits for the pod\'s units as well', () => {
    const r = busy();
    r.start('pod', { seats: 4 });
    r.start('solo');
    r.end(6);
    // ahead 5, own 1: 6 of the 6 units freed in the minute
    expect(r.adm.lookup('solo', r.now)).toEqual({ position: 2, unitsAhead: 5, estimatedWaitMs: MIN });
    expect(r.adm.lookup('pod', r.now)).toEqual({ position: 1, unitsAhead: 0, estimatedWaitMs: 50_000 });
  });

  it('a new start is told the estimate as of now', () => {
    const r = busy();
    r.start('A');
    r.end(3);
    expect(waitingOf(r.start('B'))).toEqual({ position: 2, unitsAhead: 1, estimatedWaitMs: 40_000 });
  });
});

describe('M13-10: the FreedWindow', () => {
  it('sums the units freed in the window, drops older ones, and measures the span', () => {
    const w = new FreedWindow(10 * MIN, MIN);
    expect(w.span(5_000)).toBe(MIN);
    w.start(1_000);
    w.start(500_000); // the first call counts
    w.add(3, 2_000);
    w.add(4, 100_000);
    expect(w.units(100_000)).toBe(7);
    expect(w.span(30_000)).toBe(MIN);
    expect(w.span(301_000)).toBe(300_000);
    expect(w.span(5_000_000)).toBe(10 * MIN);
    expect(w.units(2_000 + 10 * MIN - 1)).toBe(7);
    expect(w.units(2_000 + 10 * MIN)).toBe(4);
    expect(w.units(100_000 + 10 * MIN)).toBe(0);
    expect(w.estimate(5, 100_000 + 10 * MIN)).toBeNull();
    w.add(10, 800_000);
    expect(w.estimate(5, 800_000)).toBe(300_000);
  });

  it('keeps counting right over a long run (many frees over many windows)', () => {
    const w = new FreedWindow(MIN, 10_000);
    let total = 0;
    for (let i = 0; i < 5_000; i++) {
      w.add(1, i * 1_000);
      total += w.units(i * 1_000);
    }
    // in each second the window holds the last 60 frees (the one at the window's edge has dropped out: `at <= now - window`)
    expect(w.units(4_999_000)).toBe(60);
    expect(total).toBeGreaterThan(0);
  });
});

describe('M13-10: position events', () => {
  it('only on a change, and at most one per start every 5 s: a change held back goes at a later step', () => {
    const r = busy();
    for (const id of ['A', 'B', 'C']) r.start(id);
    expect(r.go(SEC)).toEqual([]);
    expect(r.adm.withdraw('A', r.now)).toBe(true);
    // 2 s after the starts were told: too soon; 5 s: the held-back change goes
    expect(r.go(SEC)).toEqual([]);
    expect(r.go(3 * SEC)).toEqual([
      { kind: 'position', table: 'B', position: 1, unitsAhead: 0, estimatedWaitMs: null },
      { kind: 'position', table: 'C', position: 2, unitsAhead: 1, estimatedWaitMs: null },
    ]);
    // nothing changed since
    expect(r.go(10 * SEC)).toEqual([]);
    expect(r.go(10 * SEC)).toEqual([]);
  });

  it('an estimate that moves a little is not news; one that moves by a fifth and 10 s is', () => {
    const r = busy();
    r.start('A');
    r.start('B', { seats: 4 });
    r.start('C');
    r.go(6 * SEC);
    // six units freed: for everyone an estimate appears where there was none (news, 6 s after the starts were told)
    expect(r.tables(r.end(6), 'position')).toEqual(['A', 'B', 'C']);
    // 6 s later one more unit freed: C's estimate 70 s -> 60 s is a move of 10 s, under a fifth of the 70 s shown: no event, for anyone
    r.go(6 * SEC);
    expect(r.end(1)).toEqual([]);
    expect(r.adm.lookup('C', r.now)?.estimatedWaitMs).toBe(60_000);
    // 6 s later three more: C 42 s (7 units of 10 in a minute) against the 70 s shown is news, and so is B's 36 s against 60 s; A's 6 s against 10 s is not
    r.go(6 * SEC);
    const ev = r.end(3);
    expect(r.tables(ev, 'position')).toEqual(['B', 'C']);
    expect(ev.find((e) => e.kind === 'position' && e.table === 'C')).toEqual({ kind: 'position', table: 'C', position: 3, unitsAhead: 6, estimatedWaitMs: 42_000 });
  });

  it('a position given when the start asked counts as told: the next event comes at least 5 s later', () => {
    const r = busy();
    r.start('A');
    r.end(6); // the estimate changes at once: null -> 10 s
    expect(r.go(4_999)).toEqual([]);
    expect(r.go(1)).toEqual([{ kind: 'position', table: 'A', position: 1, unitsAhead: 0, estimatedWaitMs: 10_000 }]);
  });

  it('a start behind a start that is admitted moves up and is told', () => {
    const r = new Rig({ limits: { capacityUnits: 10 } });
    r.sig.set({ runningUnits: 10 });
    r.start('A');
    r.start('B');
    r.start('C');
    r.go(6 * SEC);
    const ev = r.end(1);
    expect(ev).toEqual([
      { kind: 'admitted', table: 'A' },
      { kind: 'position', table: 'B', position: 1, unitsAhead: 0, estimatedWaitMs: 60_000 },
      { kind: 'position', table: 'C', position: 2, unitsAhead: 1, estimatedWaitMs: 120_000 },
    ]);
  });
});

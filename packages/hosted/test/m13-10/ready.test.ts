/**
 * M13-10: reserved units and ready checks (design 4.6): an admitted start holds its units until `begun` or `released`; one freed slot never admits
 * several heads within one ready-check window; a ready check that times out (30 s for tables, 15 s for matches, plus the grace for the runtime's start)
 * frees its units by itself.
 */
import { describe, expect, it } from 'vitest';
import { Rig, SEC, waitingOf } from './helpers';

const small = () => {
  const r = new Rig({ limits: { capacityUnits: 10 } });
  r.sig.set({ runningUnits: 10 });
  return r;
};

describe('M13-10: reserved units', () => {
  it('one freed slot admits one head, not several within a ready-check window', () => {
    const r = small();
    r.start('A');
    r.start('B');
    r.start('C');
    expect(r.tables(r.end(1), 'admitted')).toEqual(['A']);
    expect(r.adm.size()).toEqual({ starts: 2, units: 2, reserved: 1 });
    // the window runs: ticks and more waiting change nothing, B does not fit beside A's reserved unit
    for (let i = 0; i < 6; i++) expect(r.tables(r.go(5 * SEC), 'admitted')).toEqual([]);
    expect(r.adm.isReserved('A')).toBe(true);
  });

  it('the reservation ends with begun: the runtime counts the game from then on, and the units are not counted twice for good', () => {
    const r = small();
    r.start('A');
    r.start('B');
    r.end(1);
    expect(r.adm.size().reserved).toBe(1);
    // `start` made the runtime count A (running 10 again), then `begun` ends the reservation
    r.begin('A', 1);
    expect(r.adm.size().reserved).toBe(0);
    expect(r.adm.isReserved('A')).toBe(false);
    expect(r.tables(r.go(5 * SEC), 'admitted')).toEqual([]);
    expect(r.tables(r.end(1), 'admitted')).toEqual(['B']);
    expect(r.adm.stats().begun).toBe(1);
  });

  it('released (the ready check failed or a seat left): the units are free again and the head is re-checked', () => {
    const r = small();
    r.start('A');
    r.start('B');
    r.start('C');
    r.end(1);
    expect(r.adm.isReserved('A')).toBe(true);
    const ev = r.adm.released('A', r.now, 'readyCheck');
    expect(r.tables(ev, 'admitted')).toEqual(['B']);
    expect(r.adm.isReserved('A')).toBe(false);
    expect(r.adm.size()).toEqual({ starts: 1, units: 1, reserved: 1 });
    expect(r.value('openmtg_hosted_ready_check_failures_total', { kind: 'table' })).toBe(1);
    expect(r.adm.stats().released).toBe(1);
  });

  it('counts a failed ready check of a match as a match, and one of a private or listed table as a table', () => {
    const r = new Rig();
    r.start('m', { source: 'matched' });
    r.start('p', { source: 'private' });
    r.start('l', { source: 'listed' });
    r.adm.released('m', r.now, 'readyCheck');
    r.adm.released('p', r.now, 'readyCheck');
    r.adm.released('l', r.now, 'readyCheck');
    expect(r.value('openmtg_hosted_ready_check_failures_total', { kind: 'match' })).toBe(1);
    expect(r.value('openmtg_hosted_ready_check_failures_total', { kind: 'table' })).toBe(2);
  });

  it('releasing a start that holds no reservation does nothing', () => {
    const r = small();
    r.start('W');
    expect(r.adm.released('W', r.now)).toEqual([]);
    expect(r.adm.released('unknown', r.now)).toEqual([]);
    expect(r.adm.isWaiting('W')).toBe(true);
    r.adm.begun('unknown', r.now);
    expect(r.adm.size()).toEqual({ starts: 1, units: 1, reserved: 0 });
    expect(r.value('openmtg_hosted_ready_check_failures_total', { kind: 'table' })).toBeUndefined();
  });

  it('a table whose ready check failed goes back to the lobby and, when full again, to the back of the queue', () => {
    const r = small();
    for (const id of ['A', 'B', 'C']) r.start(id);
    r.end(1);
    r.adm.released('A', r.now); // B takes the unit; C waits
    expect(r.adm.isWaiting('C')).toBe(true);
    r.go(10 * SEC);
    expect(waitingOf(r.start('A'))).toMatchObject({ position: 2, unitsAhead: 1 });
    expect(r.adm.lookup('C', r.now)).toMatchObject({ position: 1 });
  });

  it('a pod\'s reservation holds all its units: nothing else is admitted beside it until it begins or is released', () => {
    const r = small();
    r.start('pod', { seats: 4 });
    r.start('solo');
    r.sig.set({ runningUnits: 5 });
    expect(r.tables(r.go(SEC), 'admitted')).toEqual(['pod']);
    expect(r.adm.size().reserved).toBe(5);
    // 5 running + 5 reserved: the 1v1 game waits until the pod has begun and a unit has freed, or until the pod is released
    expect(r.tables(r.go(10 * SEC), 'admitted')).toEqual([]);
    expect(r.tables(r.adm.released('pod', r.now), 'admitted')).toEqual(['solo']);
  });
});

describe('M13-10: ready-check timeouts free the reserved units by themselves', () => {
  /** 9 of 10 units running: the first start takes the last unit, the second waits for it. */
  const lastUnit = (source: 'listed' | 'private' | 'matched') => {
    const r = new Rig({ limits: { capacityUnits: 10 } });
    r.sig.set({ runningUnits: 9 });
    expect(r.start('first', { source })).toEqual({ kind: 'admitted' });
    expect(r.ask('second')).toBe('waiting');
    return r;
  };

  it('a table\'s reservation lapses 30 s after its ready check began plus the 10 s grace for the runtime\'s start: the head goes', () => {
    for (const source of ['listed', 'private'] as const) {
      const r = lastUnit(source);
      expect(r.go(39_999)).toEqual([]);
      expect(r.adm.isReserved('first')).toBe(true);
      expect(r.go(1)).toEqual([{ kind: 'admitted', table: 'second' }]);
      expect(r.adm.isReserved('first')).toBe(false);
      expect(r.adm.size()).toEqual({ starts: 0, units: 0, reserved: 1 });
      expect(r.value('openmtg_hosted_ready_check_failures_total', { kind: 'table' })).toBe(1);
      expect(r.adm.stats().lapsed).toBe(1);
      expect(r.logger.entries().filter((e) => e['event'] === 'capacityLapsed')).toHaveLength(1);
    }
  });

  it('a match\'s reservation lapses 15 s plus the grace', () => {
    const r = lastUnit('matched');
    expect(r.go(24_999)).toEqual([]);
    expect(r.go(1)).toEqual([{ kind: 'admitted', table: 'second' }]);
    expect(r.value('openmtg_hosted_ready_check_failures_total', { kind: 'match' })).toBe(1);
  });

  it('a start that began in time never lapses; a late `begun` or `released` after a lapse is harmless', () => {
    const r = lastUnit('listed');
    r.go(29 * SEC);
    r.begin('first', 1); // the runtime counts it: 10 of 10 running
    expect(r.go(60 * SEC)).toEqual([]);
    expect(r.adm.stats().lapsed).toBe(0);
    expect(r.adm.size()).toEqual({ starts: 1, units: 1, reserved: 0 });

    const late = lastUnit('listed');
    late.go(41 * SEC);
    expect(late.adm.isReserved('first')).toBe(false);
    late.adm.begun('first', late.now);
    expect(late.adm.released('first', late.now)).toEqual([]);
    expect(late.adm.size()).toEqual({ starts: 0, units: 0, reserved: 1 });
    expect(late.value('openmtg_hosted_ready_check_failures_total', { kind: 'table' })).toBe(1);
  });

  it('the lengths are configurable, and a reservation holds the units of its own size', () => {
    const r = new Rig({ limits: { capacityUnits: 10 }, timing: { readyCheckTableMs: 5 * SEC, startGraceMs: 1 * SEC } });
    r.sig.set({ runningUnits: 5 });
    expect(r.start('pod', { seats: 4 })).toEqual({ kind: 'admitted' });
    expect(r.ask('solo')).toBe('waiting');
    expect(r.go(5_999)).toEqual([]);
    expect(r.tables(r.go(1), 'admitted')).toEqual(['solo']);
  });
});

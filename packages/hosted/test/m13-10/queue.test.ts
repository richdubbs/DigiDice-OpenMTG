/**
 * M13-10: the FIFO capacity queue (design 4.6): admission under the soft limit, strict FIFO in units with mixed 1v1 games and pods, no overtaking, no
 * priority for any source. Fake clock, hand-set signals, fixed inputs.
 */
import { describe, expect, it } from 'vitest';
import { Rig, waitingOf } from './helpers';

/** Capacity 10: small enough to walk through by hand (a 4-player pod is 5 units, a 3-player pod 4, a 1v1 game 1). */
const small = () => new Rig({ limits: { capacityUnits: 10 } });

describe('M13-10: admission under the soft limit', () => {
  it('admits a start at once and reserves its units: 1 for a 1v1 game, 4 for a 3-player pod, 5 for a 4-player pod', () => {
    const r = new Rig();
    expect(r.start('t1')).toEqual({ kind: 'admitted' });
    expect(r.start('t2', { seats: 3 })).toEqual({ kind: 'admitted' });
    expect(r.start('t3', { seats: 4 })).toEqual({ kind: 'admitted' });
    expect(r.adm.size()).toEqual({ starts: 0, units: 0, reserved: 10 });
    expect(r.adm.stats()).toMatchObject({ admitted: 3, immediate: 3 });
  });

  it('"under the soft limit" means its units fit and no other signal is set: at 899 of 900 a 1v1 game is admitted and a pod waits', () => {
    const r = new Rig();
    r.sig.set({ runningUnits: 899 });
    expect(r.ask('pod', { seats: 4 })).toBe('waiting');
    const solo = new Rig();
    solo.sig.set({ runningUnits: 899 });
    expect(solo.ask('one')).toBe('admitted');
    // the reserved unit counts: the second 1v1 game does not fit beside it
    expect(solo.ask('two')).toBe('waiting');
  });

  it('a start that arrives while anything waits waits too, even when its units would fit', () => {
    const r = small();
    r.sig.set({ runningUnits: 6 });
    expect(waitingOf(r.start('pod', { seats: 4 }))).toEqual({ position: 1, unitsAhead: 0, estimatedWaitMs: null });
    // 4 units are free and a 1v1 game needs 1; it still waits behind the pod
    expect(waitingOf(r.start('solo'))).toEqual({ position: 2, unitsAhead: 5, estimatedWaitMs: null });
    expect(r.go(1_000)).toEqual([]);
    expect(r.adm.size()).toEqual({ starts: 2, units: 6, reserved: 0 });
  });
});

describe('M13-10: strict FIFO in units', () => {
  it('admits mixed 1v1 games and pods in the order they began waiting, one head at a time as units free', () => {
    const r = small();
    r.sig.set({ runningUnits: 10 });
    expect(waitingOf(r.start('A'))).toMatchObject({ position: 1, unitsAhead: 0 });
    expect(waitingOf(r.start('B', { seats: 4 }))).toMatchObject({ position: 2, unitsAhead: 1 });
    expect(waitingOf(r.start('C'))).toMatchObject({ position: 3, unitsAhead: 6 });
    expect(waitingOf(r.start('D', { seats: 3 }))).toMatchObject({ position: 4, unitsAhead: 7 });
    expect(waitingOf(r.start('E'))).toMatchObject({ position: 5, unitsAhead: 11 });
    expect(r.adm.size()).toEqual({ starts: 5, units: 12, reserved: 0 });

    // one game ends: A (1 unit) fits; B behind it (5 units) does not
    expect(r.tables(r.end(1), 'admitted')).toEqual(['A']);
    r.begin('A', 1);
    // four more 1v1 games end: six units are running. B (5) needs the running units at 5 or less; C would fit, but may not pass B.
    for (let i = 0; i < 4; i++) expect(r.end(1)).toEqual([]);
    expect(r.sig.s.runningUnits).toBe(6);
    expect(r.adm.size().starts).toBe(4);
    expect(r.tables(r.end(1), 'admitted')).toEqual(['B']);
    // B holds 5 units reserved: C (1) does not fit beside 5 running and 5 reserved, nobody else is admitted
    expect(r.go(1_000)).toEqual([]);
    r.begin('B', 5);
    expect(r.tables(r.end(1), 'admitted')).toEqual(['C']);
    r.begin('C', 1);
    for (let i = 0; i < 3; i++) expect(r.end(1)).toEqual([]);
    expect(r.tables(r.end(1), 'admitted')).toEqual(['D']);
    r.begin('D', 4);
    expect(r.tables(r.end(1), 'admitted')).toEqual(['E']);
    expect(r.adm.size()).toEqual({ starts: 0, units: 0, reserved: 1 });
    expect(r.adm.stats()).toMatchObject({ admitted: 5, immediate: 0 });
  });

  it('never overtakes: a pod at the head is not starved by a stream of 1v1 starts', () => {
    const r = small();
    r.sig.set({ runningUnits: 6 });
    r.start('pod', { seats: 4 });
    for (let i = 1; i <= 8; i++) expect(waitingOf(r.start(`x${i}`)).position).toBe(i + 1);
    // 4 units are free all the time, enough for four 1v1 games, and none of them passes the pod
    for (let i = 0; i < 5; i++) expect(r.go(10_000)).toEqual([]);
    expect(r.adm.size()).toEqual({ starts: 9, units: 13, reserved: 0 });

    // one unit more frees: the pod is admitted, nobody behind it
    expect(r.tables(r.end(1), 'admitted')).toEqual(['pod']);
    expect(r.go(1_000)).toEqual([]);
    r.begin('pod', 5);
    // from now on one freed unit admits exactly one 1v1 game, in order
    expect(r.tables(r.end(1), 'admitted')).toEqual(['x1']);
    r.begin('x1', 1);
    expect(r.tables(r.end(1), 'admitted')).toEqual(['x2']);
    expect(r.adm.size().starts).toBe(6);
  });

  it('admits several heads in one step when they all fit beside each other and the reserved units', () => {
    const r = small();
    r.sig.set({ runningUnits: 10 });
    for (const id of ['a', 'b', 'c', 'd']) r.start(id);
    r.start('pod', { seats: 4 });
    // six units free at once (games ended while nothing called admission): the four 1v1 games fit, the pod (5) does not fit beside them
    r.sig.set({ runningUnits: 4 });
    expect(r.tables(r.go(1_000), 'admitted')).toEqual(['a', 'b', 'c', 'd']);
    expect(r.adm.size()).toEqual({ starts: 1, units: 5, reserved: 4 });
  });

  it('gives no priority to any source: listed, private and matched starts (ranked ones too, milestone 15) are one FIFO', () => {
    const r = small();
    r.sig.set({ runningUnits: 10 });
    r.start('listed1', { source: 'listed' });
    r.start('matched1', { source: 'matched' });
    r.start('private1', { source: 'private' });
    r.start('matched2', { source: 'matched', seats: 4 });
    r.start('listed2', { source: 'listed' });
    expect(r.adm.lookup('matched2', r.now)).toMatchObject({ position: 4 });
    const admitted: string[] = [];
    for (let i = 0; i < 5; i++) {
      // free as many units as the next head needs, then begin it
      expect(r.adm.size().starts).toBe(5 - i);
      const need = i === 3 ? 5 : 1;
      r.sig.set({ runningUnits: 10 - need });
      const ev = r.tables(r.go(1_000), 'admitted');
      admitted.push(...ev);
      for (const t of ev) r.begin(t, t === 'matched2' ? 5 : 1);
      r.sig.set({ runningUnits: 10 });
    }
    expect(admitted).toEqual(['listed1', 'matched1', 'private1', 'matched2', 'listed2']);
  });

  it('a start asking again is not queued twice: a waiting one keeps its place, an admitted one stays admitted', () => {
    const r = small();
    expect(r.ask('first')).toBe('admitted');
    expect(r.ask('first')).toBe('admitted');
    expect(r.adm.size().reserved).toBe(1);
    r.sig.set({ runningUnits: 10 });
    r.start('w1');
    r.start('w2');
    r.go(10_000);
    // the answer is the same standing, as of now; the start stays where it was
    expect(waitingOf(r.start('w1', { since: r.now }))).toMatchObject({ position: 1 });
    expect(waitingOf(r.start('w2'))).toMatchObject({ position: 2, unitsAhead: 1 });
    expect(r.adm.size()).toEqual({ starts: 2, units: 2, reserved: 1 });
  });

  it('a table that asks again with other seats is another start: it loses its place or its reservation, and the sessions that left are free', () => {
    const r = small();
    r.sig.set({ runningUnits: 10 });
    r.start('T', { sessions: ['alice', 'bob'] });
    r.start('U');
    // bob left and carol sat down, the table is full again, and the caller did not withdraw the old start: T goes behind U
    expect(waitingOf(r.start('T', { sessions: ['alice', 'carol'] }))).toMatchObject({ position: 2, unitsAhead: 1 });
    expect(r.adm.hasWaitingSession('bob')).toBe(false);
    expect(r.adm.hasWaitingSession('carol')).toBe(true);
    expect(r.adm.size()).toEqual({ starts: 2, units: 2, reserved: 0 });
    expect(r.adm.stats().left).toBe(1);
    // the same seats in another order are the same start
    expect(waitingOf(r.start('T', { sessions: ['carol', 'alice'] }))).toMatchObject({ position: 2 });
    expect(r.adm.stats().left).toBe(1);

    // an admitted start whose seats changed: its ready check failed, and the table is admitted anew (one reservation, not two)
    const q = small();
    expect(q.ask('T', { sessions: ['a', 'b'] })).toBe('admitted');
    expect(q.ask('T', { sessions: ['a', 'b'] })).toBe('admitted');
    expect(q.adm.stats()).toMatchObject({ admitted: 1, released: 0 });
    expect(q.ask('T', { sessions: ['a', 'c'] })).toBe('admitted');
    expect(q.adm.size().reserved).toBe(1);
    expect(q.adm.stats()).toMatchObject({ admitted: 2, released: 1 });
    // a change of seats is not a failed ready check (that is only a check that ran out), and the old start left
    expect(q.value('openmtg_hosted_ready_check_failures_total', { kind: 'table' })).toBeUndefined();
  });

  it('throws for units that are not a whole number of at least 1 (a programming error), and refuses a start that could never fit', () => {
    const r = small();
    expect(() => r.adm.request(r.req('bad', { units: 0 }), r.now)).toThrow(RangeError);
    expect(() => r.adm.request(r.req('bad', { units: 1.5 }), r.now)).toThrow(RangeError);
    // 11 units on a capacity of 10: it would sit at the head for ever and stop everyone behind it
    r.sig.set({ runningUnits: 10 });
    expect(r.adm.request(r.req('huge', { units: 11 }), r.now)).toMatchObject({ kind: 'refused', reason: 'queueFull' });
    expect(r.ask('ok')).toBe('waiting');
    r.sig.set({ runningUnits: 0 });
    expect(r.tables(r.go(1_000), 'admitted')).toEqual(['ok']);
  });
});

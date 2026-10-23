/**
 * M13-10: leaving while waiting (design 4.6: `unqueue`, `leave`, a seat that reopened, a match's other players going back to their matchmaking queue):
 * the start no longer waits, the places behind it move up, its session and address are free, and a start that asks again goes to the back.
 */
import { describe, expect, it } from 'vitest';
import { MIN, Rig, waitingOf } from './helpers';

const busy = () => {
  const r = new Rig({ limits: { capacityUnits: 10 } });
  r.sig.set({ cpu: 0.9 });
  return r;
};

describe('M13-10: leaving while waiting', () => {
  it('a start that leaves from the middle: the starts behind move up, and are told at the next step', () => {
    const r = busy();
    for (const id of ['A', 'B', 'C', 'D']) r.start(id);
    expect(r.adm.withdraw('B', r.now)).toBe(true);
    expect(r.adm.size()).toEqual({ starts: 3, units: 3, reserved: 0 });
    expect(r.adm.isWaiting('B')).toBe(false);
    expect(r.adm.lookup('B', r.now)).toBeNull();
    expect(r.adm.lookup('C', r.now)).toEqual({ position: 2, unitsAhead: 1, estimatedWaitMs: null });
    // positions are reported at most every 5 s: the change is held until then
    expect(r.go(2_000)).toEqual([]);
    expect(r.go(3_000)).toEqual([
      { kind: 'position', table: 'C', position: 2, unitsAhead: 1, estimatedWaitMs: null },
      { kind: 'position', table: 'D', position: 3, unitsAhead: 2, estimatedWaitMs: null },
    ]);
    expect(r.go(60_000)).toEqual([]);
    expect(r.adm.stats().left).toBe(1);
  });

  it('the head leaves: the next head is admitted at the next step when it fits, never before it', () => {
    const r = busy();
    r.sig.set({ cpu: 0.1, runningUnits: 6 });
    r.start('pod', { seats: 4 }); // 5 units: does not fit beside 6 running
    r.start('solo');
    expect(r.adm.withdraw('pod', r.now)).toBe(true);
    // the next head fits and is admitted at once; its event is carried to the next step's return (or `onEvents`: see the nits' tests)
    expect(r.adm.size()).toEqual({ starts: 0, units: 0, reserved: 1 });
    expect(r.tables(r.go(1_000), 'admitted')).toEqual(['solo']);
  });

  it('a start that is not waiting cannot leave: unknown, already admitted, or begun', () => {
    const r = new Rig();
    expect(r.adm.withdraw('nobody', r.now)).toBe(false);
    expect(r.ask('admitted at once')).toBe('admitted');
    // an admitted start is released, not withdrawn
    expect(r.adm.withdraw('admitted at once', r.now)).toBe(false);
    expect(r.adm.isReserved('admitted at once')).toBe(true);
    r.begin('admitted at once', 1);
    expect(r.adm.withdraw('admitted at once', r.now)).toBe(false);
    r.sig.set({ cpu: 0.9 });
    r.start('W');
    expect(r.adm.withdraw('W', r.now)).toBe(true);
    expect(r.adm.withdraw('W', r.now)).toBe(false);
  });

  it('frees the session and the address key; a start that asks again goes to the back with the time it asks', () => {
    const r = busy();
    r.start('A', { sessions: ['alice'], addressKeys: ['k'] });
    r.go(MIN);
    r.start('B');
    r.start('C');
    expect(r.adm.hasWaitingSession('alice')).toBe(true);
    expect(r.adm.withdraw('A', r.now)).toBe(true);
    expect(r.adm.hasWaitingSession('alice')).toBe(false);
    // the seat reopened and the table filled again: it asks again and waits behind B and C
    expect(waitingOf(r.start('A', { sessions: ['alice'], addressKeys: ['k'] }))).toMatchObject({ position: 3, unitsAhead: 2 });
    // the order of the others is unchanged
    expect(r.adm.lookup('B', r.now)).toMatchObject({ position: 1 });
    expect(r.adm.lookup('C', r.now)).toMatchObject({ position: 2 });
  });

  it('the starts of a pod and of a 1v1 table leave the same way: their units go from the queue', () => {
    const r = busy();
    r.start('pod', { seats: 4 });
    r.start('pod3', { seats: 3 });
    r.start('solo');
    expect(r.adm.size()).toEqual({ starts: 3, units: 10, reserved: 0 });
    expect(r.adm.withdraw('pod', r.now)).toBe(true);
    expect(r.adm.size()).toEqual({ starts: 2, units: 5, reserved: 0 });
    expect(r.adm.lookup('solo', r.now)).toMatchObject({ position: 2, unitsAhead: 4 });
  });
});

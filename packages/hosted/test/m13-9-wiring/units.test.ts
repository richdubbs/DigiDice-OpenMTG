/**
 * M13-13 part B: `MatchAdmission`, the router between capacity admission and the layers that own tables (match/service.ts): every call goes to the real
 * admission, and the events come out split by owner. Fixed inputs, no clock.
 */
import { describe, expect, it } from 'vitest';
import type { Admission, AdmissionEvent, StartRequest } from '../../src/admission/api';
import { MatchAdmission } from '../../src/match/service';

const admitted = (table: string): AdmissionEvent => ({ kind: 'admitted', table });
const position = (table: string): AdmissionEvent => ({ kind: 'position', table, position: 1, unitsAhead: 0, estimatedWaitMs: null });

/** An admission that records its calls and answers with the events it was given. */
function inner(events: AdmissionEvent[]): Admission & { calls: string[] } {
  const calls: string[] = [];
  const decision = { kind: 'admitted' } as const;
  return {
    calls,
    request: (r) => (calls.push(`request ${r.table}`), decision),
    withdraw: (t) => (calls.push(`withdraw ${t}`), true),
    begun: (t) => void calls.push(`begun ${t}`),
    released: (t, _now, cause) => (calls.push(`released ${t} ${cause}`), events),
    freed: (u) => (calls.push(`freed ${u}`), events),
    tick: () => (calls.push('tick'), events),
    size: () => ({ starts: 1, units: 2, reserved: 3 }),
    drain: () => void calls.push('drain'),
    capacityState: () => 'queueing',
    lookup: (t) => ({ position: 4, unitsAhead: 5, estimatedWaitMs: t.length }),
    isWaiting: (t) => t === 'W',
    hasWaitingSession: (s) => s === 'S',
    restore: (starts) => starts.map((r) => ({ table: r.table, decision: decision })),
  };
}

const owner = (mine: string[]) => {
  const got: AdmissionEvent[][] = [];
  return { got, owns: (t: string) => mine.includes(t), onAdmission: (e: readonly AdmissionEvent[]) => void got.push([...e]) };
};

describe('M13-13 MatchAdmission', () => {
  it('without an owner it is the admission itself: every call goes through, every event comes back', () => {
    const a = inner([admitted('T1')]);
    const m = new MatchAdmission(a);
    expect(m.tick(5)).toEqual([admitted('T1')]);
    expect(m.freed(3, 5)).toEqual([admitted('T1')]);
    expect(m.released('T1', 5, 'readyCheck')).toEqual([admitted('T1')]);
    expect(a.calls).toEqual(['tick', 'freed 3', 'released T1 readyCheck']);
  });

  it('the events of the owner\'s tables go to the owner (after the call returns), the others are returned', async () => {
    const a = inner([admitted('M1'), position('T1'), position('M2'), admitted('T2')]);
    const o = owner(['M1', 'M2']);
    const m = new MatchAdmission(a);
    m.owner = o;
    for (const call of [() => m.tick(1), () => m.freed(1, 1), () => m.released('x', 1, 'left')]) {
      o.got.length = 0;
      expect(call()).toEqual([position('T1'), admitted('T2')]);
      // not inside the call: the owner's handler may call admission again
      expect(o.got).toEqual([]);
      await Promise.resolve();
      expect(o.got).toEqual([[admitted('M1'), position('M2')]]);
    }
  });

  it('events only of the tables layer\'s tables are returned untouched, and nothing is given to the owner', async () => {
    const m = new MatchAdmission(inner([admitted('T1')]));
    const o = owner(['M1']);
    m.owner = o;
    expect(m.tick(1)).toEqual([admitted('T1')]);
    await Promise.resolve();
    expect(o.got).toEqual([]);
  });

  it('dispatch (admission\'s onEvents: events outside a step) splits at once: the owner\'s to the owner, the rest to the tables layer', () => {
    const m = new MatchAdmission(inner([]));
    const o = owner(['M1']);
    m.owner = o;
    const others: AdmissionEvent[][] = [];
    m.dispatch([admitted('M1'), admitted('T1')], (e) => others.push(e));
    expect(o.got).toEqual([[admitted('M1')]]);
    expect(others).toEqual([[admitted('T1')]]);
    m.dispatch([admitted('M1')], (e) => others.push(e));
    expect(others).toHaveLength(1);
    // before an owner exists everything is the tables layer's
    const bare = new MatchAdmission(inner([]));
    bare.dispatch([admitted('M1')], (e) => others.push(e));
    expect(others[1]).toEqual([admitted('M1')]);
  });

  it('the rest of the contract is passed on as it is', () => {
    const a = inner([]);
    const m = new MatchAdmission(a);
    const req: StartRequest = { table: 'T', source: 'matched', seats: 2, units: 1, sessions: ['a', 'b'], addressKeys: ['x'], since: 1 };
    expect(m.request(req, 1)).toEqual({ kind: 'admitted' });
    expect(m.withdraw('T', 1)).toBe(true);
    m.begun('T', 1);
    m.drain();
    expect(a.calls).toEqual(['request T', 'withdraw T', 'begun T', 'drain']);
    expect(m.size()).toEqual({ starts: 1, units: 2, reserved: 3 });
    expect(m.capacityState()).toBe('queueing');
    expect(m.lookup('abc', 1)).toEqual({ position: 4, unitsAhead: 5, estimatedWaitMs: 3 });
    expect(m.isWaiting('W')).toBe(true);
    expect(m.isWaiting('X')).toBe(false);
    expect(m.hasWaitingSession('S')).toBe(true);
    expect(m.restore([req], 1)).toEqual([{ table: 'T', decision: { kind: 'admitted' } }]);
  });
});

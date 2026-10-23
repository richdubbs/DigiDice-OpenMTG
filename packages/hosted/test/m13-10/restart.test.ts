/**
 * M13-10: restart order (design 4.6, 4.7): the queue is in memory; the time a table started waiting is stored with it (`games.waiting_since`), so after a
 * restart full lobby and matched tables re-enter the queue in their old order, and ready checks in progress are restarted.
 */
import { describe, expect, it } from 'vitest';
import { MIN, Rig, waitingOf } from './helpers';

/** What the new process finds in the store: the tables that were waiting, with their `waiting_since` (offsets from the restart, in minutes). */
const BEFORE = [
  { id: 'T5', at: -1 },
  { id: 'T1', at: -9 },
  { id: 'T4', at: -3 },
  { id: 'T2', at: -7 },
  { id: 'T3', at: -5 },
] as const;

describe('M13-10: after a restart', () => {
  it('a new process starts with an empty queue and nothing reserved: the queue is in memory', () => {
    const r = new Rig();
    expect(r.adm.size()).toEqual({ starts: 0, units: 0, reserved: 0 });
    expect(r.adm.capacityState()).toBe('open');
  });

  it('asking one by one (request) never back-dates: a start that claims an older waiting time goes to the back, and keeps the order they asked in', () => {
    const r = new Rig();
    r.sig.set({ cpu: 0.9 });
    for (const t of BEFORE) r.start(t.id, { since: r.now + t.at * MIN });
    // T5 asked first (-1 min); T1 (-9 min) may not pass it: each start's time is held to the last waiting start's
    expect(BEFORE.map((t) => r.adm.lookup(t.id, r.now)?.position)).toEqual([1, 2, 3, 4, 5]);
    r.sig.set({ cpu: 0.1 });
    expect(r.tables(r.go(1_000), 'admitted')).toEqual(['T5', 'T1', 'T4', 'T2', 'T3']);
  });

  it('equal times keep the order the starts asked in; a time older than the last waiting start\'s is held to it', () => {
    const r = new Rig();
    r.sig.set({ cpu: 0.9 });
    for (const id of ['b', 'a', 'c']) r.start(id, { since: r.now - MIN });
    r.start('late', { since: r.now });
    r.start('early', { since: r.now - 2 * MIN });
    expect(['b', 'a', 'c', 'late', 'early'].map((id) => r.adm.lookup(id, r.now)?.position)).toEqual([1, 2, 3, 4, 5]);
  });

  it('`restore` is the only way back: the same starts in a scrambled order re-enter by their waiting_since', () => {
    const r = new Rig();
    r.sig.set({ cpu: 0.9 });
    r.adm.restore(BEFORE.map((t) => r.req(t.id, { since: r.now + t.at * MIN })), r.now);
    // the queue is T1 (oldest) to T5, and each start's place says so
    expect(BEFORE.map((t) => r.adm.lookup(t.id, r.now)?.position)).toEqual([5, 1, 4, 2, 3]);
    expect(r.adm.lookup('T4', r.now)).toMatchObject({ position: 4, unitsAhead: 3 });
    // freeing capacity admits them oldest first
    r.sig.set({ cpu: 0.1 });
    expect(r.tables(r.go(1_000), 'admitted')).toEqual(['T1', 'T2', 'T3', 'T4', 'T5']);
    // and a start that asks after a restore (not a restored one) goes behind them, whatever it claims
    const later = new Rig();
    later.sig.set({ cpu: 0.9 });
    later.adm.restore([later.req('old', { since: later.now - 5 * MIN })], later.now);
    later.start('new', { since: later.now - 9 * MIN });
    expect(later.adm.lookup('new', later.now)).toMatchObject({ position: 2 });
  });

  it('`restore` asks in the old order, so with room for one start the oldest takes it', () => {
    const r = new Rig({ limits: { capacityUnits: 10 } });
    r.sig.set({ runningUnits: 9 }); // the recovered games run again; one unit is free
    const starts = BEFORE.map((t) => r.req(t.id, { since: r.now + t.at * MIN }));
    const done = r.adm.restore([starts[0]!, starts[1]!, starts[2]!], r.now); // T5, T1, T4
    expect(done.map((d) => d.table)).toEqual(['T1', 'T4', 'T5']);
    expect(done.map((d) => d.decision.kind)).toEqual(['admitted', 'waiting', 'waiting']);
    expect(waitingOf(done[1]!.decision)).toMatchObject({ position: 1, unitsAhead: 0 });
    expect(waitingOf(done[2]!.decision)).toMatchObject({ position: 2, unitsAhead: 1 });
  });

  it('`restore` breaks a tie by table id, so the order does not depend on how the store listed them', () => {
    const a = new Rig();
    const b = new Rig();
    for (const r of [a, b]) r.sig.set({ cpu: 0.9 });
    const since = a.now - MIN;
    a.adm.restore(['x', 'y', 'z'].map((id) => a.req(id, { since })), a.now);
    b.adm.restore(['z', 'x', 'y'].map((id) => b.req(id, { since })), b.now);
    expect(['x', 'y', 'z'].map((id) => a.adm.lookup(id, a.now)?.position)).toEqual([1, 2, 3]);
    expect(['x', 'y', 'z'].map((id) => b.adm.lookup(id, b.now)?.position)).toEqual([1, 2, 3]);
  });

  it('a ready check in progress is restarted: the table asks again and is admitted anew, with a fresh reservation', () => {
    const r = new Rig();
    // before the restart T1 was admitted and its ready check ran; the old process is gone, with its reservation
    const t1 = r.req('T1', { since: r.now - 40 * 1_000 });
    expect(r.adm.restore([t1], r.now)).toEqual([{ table: 'T1', decision: { kind: 'admitted' } }]);
    expect(r.adm.isReserved('T1')).toBe(true);
    expect(r.adm.size().reserved).toBe(1);
    // the wait it had before the restart is in the histogram
    expect(r.observed('openmtg_hosted_capacity_wait_seconds')).toEqual([40]);
  });

  it('the wait limit counts from waiting_since: a table that waited 19 minutes before the restart has one minute left', () => {
    const r = new Rig();
    r.sig.set({ cpu: 0.9 });
    r.adm.restore([r.req('old', { since: r.now - 19 * MIN })], r.now);
    expect(r.tables(r.go(MIN), 'expired')).toEqual([]);
    expect(r.tables(r.go(1), 'expired')).toEqual(['old']);
  });

  it('the address and session limits and the queue limit apply to restored starts like to any other', () => {
    const r = new Rig({ limits: { queueMax: 2 } });
    r.sig.set({ cpu: 0.9 });
    const done = r.adm.restore(
      [
        r.req('a', { since: r.now - 3 * MIN, sessions: ['s1'], addressKeys: ['k'] }),
        r.req('b', { since: r.now - 2 * MIN, sessions: ['s1'], addressKeys: ['j'] }),
        r.req('c', { since: r.now - 1 * MIN, sessions: ['s3'], addressKeys: ['l'] }),
        r.req('d', { since: r.now, sessions: ['s4'], addressKeys: ['m'] }),
      ],
      r.now,
    );
    expect(done.map((d) => (d.decision.kind === 'refused' ? d.decision.reason : d.decision.kind))).toEqual(['waiting', 'session', 'waiting', 'queueFull']);
  });
});

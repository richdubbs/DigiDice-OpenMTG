/**
 * M13-10, the independent review's findings (regression tests, one group per finding) and the mutations that survived the first tests: the stale heap
 * (2), `since` (3), ready-check counts (4), CAPACITY_UNITS=1 without pods (5), pacing (6), the freed window's size (7), the queue's own copy of a request
 * (8), the leave metric, the estimate's cap and the timeout label (9), the widened interface (10), the nits (11). Finding 1 (the runtime's unit weights)
 * needs the real runtime: runtime-units.test.ts.
 */
import { describe, expect, it } from 'vitest';
import {
  admissionLimitsOf, CapacityAdmission, FreedWindow, ImmediateAdmission, estimateWaitMs, type Admission, type AdmissionEvent, type ReleaseCause, type StartRequest,
} from '../../src/admission';
import { parseConfig } from '../../src/config';
import { MatchReadyCheck, settleReadyCheck, type Match, type Matcher } from '../../src/match';
import { MemoryMetrics } from '../../src/obs';
import { HEAP_MAX_AGE_MS, RuntimeSignals } from '../../src/runtime';
import { MIN, Rig, SEC, waitingOf } from './helpers';

/** Everything waits (the CPU is over its soft level) and 100 units run, so frees change the estimate and nothing is admitted. */
const busy = (o: ConstructorParameters<typeof Rig>[0] = {}) => {
  const r = new Rig(o);
  r.sig.set({ cpu: 0.9, runningUnits: 100 });
  return r;
};

describe('review 2: a stale heap reading cannot keep admission closed', () => {
  function rig() {
    const t = { now: 1_000_000 };
    const signals = new RuntimeSignals({ runningUnits: () => 0, workers: () => 2, outbound: () => 0 }, 3, () => t.now);
    const adm = new CapacityAdmission({ signals });
    return { t, signals, adm };
  }

  it('a worker\'s reading counts for 30 s: after that, a worker that went quiet reads as 0', () => {
    const { t, signals } = rig();
    signals.heap(0, { used: 850, limit: 1000 });
    expect(signals.read(0).workerHeap).toBeCloseTo(0.85);
    t.now += HEAP_MAX_AGE_MS;
    expect(signals.read(0).workerHeap).toBeCloseTo(0.85);
    t.now += 1;
    expect(signals.read(0).workerHeap).toBe(0);
    // a new reply brings it back, and the other worker's fresher reading is the only one that counts meanwhile
    signals.heap(0, { used: 900, limit: 1000 });
    signals.heap(1, { used: 100, limit: 1000 });
    expect(signals.read(0).workerHeap).toBeCloseTo(0.9);
    t.now += HEAP_MAX_AGE_MS - 1;
    signals.heap(1, { used: 150, limit: 1000 });
    t.now += 2;
    expect(signals.read(0).workerHeap).toBeCloseTo(0.15);
  });

  it('the review\'s probe: a worker at 85% that then ends all its tables, an hour idle, 0 running: the start is admitted, not refused serverBusy', () => {
    const { t, signals, adm } = rig();
    signals.heap(0, { used: 850, limit: 1000 });
    const ask = (id: string) => adm.request({ table: id, source: 'listed', seats: 2, units: 1, sessions: [`s${id}`], addressKeys: [`k${id}`], since: t.now }, t.now).kind;
    expect(ask('while busy')).toBe('waiting');
    t.now += 29 * SEC;
    expect(adm.tick(t.now)).toEqual([]);
    expect(adm.softLimit()).toBe('heap');
    t.now += 2 * SEC;
    expect(adm.tick(t.now)).toEqual([{ kind: 'admitted', table: 'while busy' }]);
    t.now += 60 * MIN;
    expect(signals.read(t.now).workerHeap).toBe(0);
    expect(ask('an hour later')).toBe('admitted');
  });
});

describe('review 3: since is validated, and only restore may back-date it', () => {
  it('a since that is not a finite number is a programming error: request and restore throw, and the queue is unchanged', () => {
    const r = busy();
    r.start('A');
    for (const since of [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]) {
      expect(() => r.adm.request(r.req('B', { since }), r.now), String(since)).toThrow(RangeError);
      expect(() => r.adm.restore([r.req('B', { since })], r.now), String(since)).toThrow(RangeError);
    }
    expect(r.adm.size()).toEqual({ starts: 1, units: 1, reserved: 0 });
    // the review's case: a NaN at the head would have stopped the expiry of everyone behind it
    r.go(21 * MIN);
    expect(r.adm.size().starts).toBe(0);
  });

  it('request never jumps the queue: a start that claims an older waiting time is held to the last waiting start\'s', () => {
    const r = busy();
    r.start('A', { since: r.now });
    r.go(MIN);
    r.start('B', { since: r.now - 10 * MIN });
    expect(r.adm.lookup('B', r.now)).toMatchObject({ position: 2, unitsAhead: 1 });
    // ...and its wait counts from there (A's time): it does not expire 10 minutes before A, which it stands behind
    expect(r.tables(r.go(19 * MIN), 'expired')).toEqual([]);
    expect(r.tables(r.go(1), 'expired')).toEqual(['A', 'B']);
  });

  it('a since in the future is held to now: the start expires on time, and starts behind it are not sorted before it', () => {
    const r = busy();
    r.start('future', { since: r.now + 60 * MIN });
    r.go(MIN);
    r.start('next');
    expect(r.adm.lookup('future', r.now)).toMatchObject({ position: 1 });
    expect(r.adm.lookup('next', r.now)).toMatchObject({ position: 2 });
    // it waited from now (not from an hour later): removed 20 minutes and a moment after it asked
    expect(r.tables(r.go(20 * MIN - MIN + 1), 'expired')).toEqual(['future']);
  });

  it('on an empty queue a start keeps the waiting time it brings (a table that waited before): it expires from there', () => {
    const r = busy();
    r.start('old', { since: r.now - 19 * MIN });
    expect(r.tables(r.go(MIN), 'expired')).toEqual([]);
    expect(r.tables(r.go(1), 'expired')).toEqual(['old']);
  });
});

describe('review 4: admission alone counts ready-check failures, and only real ones', () => {
  const ready = (r: Rig, id: string, cause?: ReleaseCause) => {
    r.start(id);
    return r.adm.released(id, r.now, cause);
  };
  const failures = (r: Rig) => r.value('openmtg_hosted_ready_check_failures_total', { kind: 'table' });

  it('only a ready check that ran out counts; a seat that left, a closed table, a refused start and a release without a cause do not', () => {
    const r = new Rig();
    for (const cause of ['left', 'closed', 'startFailed', undefined] as const) ready(r, `t-${cause}`, cause);
    expect(failures(r)).toBeUndefined();
    expect(r.adm.stats()).toMatchObject({ released: 4, readyCheckFailures: 0 });
    ready(r, 'out', 'readyCheck');
    expect(failures(r)).toBe(1);
    expect(r.adm.stats()).toMatchObject({ released: 5, readyCheckFailures: 1 });
  });

  it('one failure is one count: releasing the same table again counts nothing', () => {
    const r = new Rig();
    ready(r, 't', 'readyCheck');
    expect(r.adm.released('t', r.now, 'readyCheck')).toEqual([]);
    expect(failures(r)).toBe(1);
  });

  it('a reservation that lapsed counts once, and a late release after it does not count again', () => {
    const r = new Rig();
    r.start('t');
    r.go(41 * SEC);
    expect(failures(r)).toBe(1);
    r.adm.released('t', r.now, 'readyCheck');
    expect(failures(r)).toBe(1);
  });

  it('a failed match ready check, settled by the matchmaking half and released by the gateway, is one failure in total', () => {
    const r = new Rig();
    const entry = (session: string) => ({ session, addressKey: `a-${session}`, key: { format: 'standard' as const, size: 2 as const }, deck: 'd', enteredAt: r.now, recentOpponents: [] });
    const match: Match = { key: { format: 'standard', size: 2 }, seats: 2, entries: [entry('a'), entry('b')], formedAt: r.now };
    const matcher = { missed: () => {}, requeueFront: () => {} } as unknown as Matcher;
    expect(r.adm.request({ table: 'm1', source: 'matched', seats: 2, units: 1, sessions: ['a', 'b'], addressKeys: ['a-a', 'a-b'], since: r.now }, r.now)).toEqual({ kind: 'admitted' });
    const check = new MatchReadyCheck(match, r.now);
    check.confirm('a', r.now);
    r.now += 15 * SEC;
    const outcome = check.poll(r.now)!;
    expect(outcome).toMatchObject({ kind: 'failed', reason: 'timeout' });
    // the gateway's two calls, with the metrics the matchmaking half used to count in too
    r.adm.released('m1', r.now, outcome.kind === 'failed' && outcome.reason === 'timeout' ? 'readyCheck' : 'left');
    settleReadyCheck(matcher, outcome, r.now, r.metrics);
    expect(r.value('openmtg_hosted_ready_check_failures_total', { kind: 'match' })).toBe(1);
  });
});

describe('review 5: CAPACITY_UNITS=1 is valid without pods (the local queue test of 13.5)', () => {
  const parsed = (env: Record<string, string>) => {
    const p = parseConfig(env, { cpus: 4 });
    if (!p.ok) throw new Error(p.errors.join('\n'));
    return p.config;
  };

  it('a 1v1 game must fit; the pods only when they are on offer', () => {
    expect(parseConfig({ CAPACITY_UNITS: '1' }, { cpus: 4 }).ok).toBe(true);
    expect(parseConfig({ CAPACITY_UNITS: '4', PODS_ENABLED: 'true' }, { cpus: 4 })).toMatchObject({ ok: false });
    expect(parseConfig({ CAPACITY_UNITS: '5', PODS_ENABLED: 'true' }, { cpus: 4 }).ok).toBe(true);
    expect(parseConfig({ CAPACITY_UNITS: '1', UNITS_1V1: '2' }, { cpus: 4 })).toMatchObject({ ok: false });
  });

  it('a server with CAPACITY_UNITS=1: the first start is admitted, the second waits and begins after the first game ends', () => {
    const config = parsed({ CAPACITY_UNITS: '1' });
    const r = new Rig({ limits: admissionLimitsOf(config) });
    expect(r.ask('first')).toBe('admitted');
    r.begin('first', 1);
    expect(r.ask('second')).toBe('waiting');
    expect(r.adm.capacityState()).toBe('queueing');
    expect(r.tables(r.end(1), 'admitted')).toEqual(['second']);
    // a pod could never fit: refused at once, not left at the head
    expect(r.adm.request(r.req('pod', { seats: 4 }), r.now)).toMatchObject({ kind: 'refused', reason: 'queueFull' });
  });
});

describe('review 6: pacing: the queue is admitted a tenth of the capacity per second, not all at once', () => {
  const paced = (o: ConstructorParameters<typeof Rig>[0] = {}) => new Rig({ ...o, timing: { paceFraction: 0.1, paceEveryMs: 1_000, ...o.timing } });

  it('200 queued 1v1 starts when the CPU dips: 90 units (a tenth of 900) in the first second, 90 in the next, 20 after', () => {
    const r = paced();
    r.sig.set({ cpu: 0.76 });
    for (let i = 0; i < 200; i++) expect(r.ask(`t${i}`)).toBe('waiting');
    r.sig.set({ cpu: 0.7499 });
    expect(r.tables(r.go(1_000), 'admitted')).toHaveLength(90);
    // the same second: more steps admit nothing more
    expect(r.tables(r.go(0), 'admitted')).toHaveLength(0);
    expect(r.tables(r.go(500), 'admitted')).toHaveLength(0);
    expect(r.tables(r.go(500), 'admitted')).toHaveLength(90);
    expect(r.tables(r.go(1_000), 'admitted')).toHaveLength(20);
    // in order
    const order = r.events.filter((e) => e.kind === 'admitted').map((e) => e.table);
    expect(order).toEqual(Array.from({ length: 200 }, (_, i) => `t${i}`));
    expect(r.adm.stats().paced).toBeGreaterThan(0);
  });

  it('units freed in the same second share the budget: a freed call does not open a second budget', () => {
    const r = paced({ limits: { capacityUnits: 100 } });
    r.sig.set({ runningUnits: 100 });
    for (let i = 0; i < 30; i++) r.start(`t${i}`);
    // 30 units free up at once: 10 (a tenth of 100) are admitted now, the rest over the next seconds
    r.sig.set({ runningUnits: 70 });
    expect(r.tables(r.adm.freed(30, r.now), 'admitted')).toHaveLength(10);
    expect(r.tables(r.adm.freed(0, r.now), 'admitted')).toHaveLength(0);
    r.now += 1_000;
    expect(r.tables(r.adm.tick(r.now), 'admitted')).toHaveLength(10);
  });

  it('is never less than a 4-player pod: a tenth of 10 units is 1, the budget is one pod (5), so a pod goes each second', () => {
    const r = paced({ limits: { capacityUnits: 10 } });
    r.sig.set({ runningUnits: 10 });
    r.start('pod', { seats: 4 });
    r.start('pod2', { seats: 4 });
    r.sig.set({ runningUnits: 0 });
    expect(r.tables(r.go(1_000), 'admitted')).toEqual(['pod']);
    expect(r.adm.stats().paced).toBe(1); // pod2 fits the capacity (5 + 5) but not the second's budget
    expect(r.tables(r.go(1_000), 'admitted')).toEqual(['pod2']);
  });

  it('does not slow a start that arrives with an empty queue', () => {
    const r = paced();
    for (let i = 0; i < 200; i++) expect(r.ask(`t${i}`)).toBe('admitted');
  });

  it('is configured by paceFraction and paceEveryMs (checked)', () => {
    const r = paced({ timing: { paceFraction: 0.01 } });
    r.sig.set({ cpu: 0.9 });
    for (let i = 0; i < 20; i++) r.start(`t${i}`);
    r.sig.set({ cpu: 0.1 });
    // 1% of 900 is 9 units (more than a pod's 5): nine 1v1 starts in the first second
    expect(r.tables(r.go(1_000), 'admitted')).toHaveLength(9);
    for (const bad of [{ paceFraction: 0 }, { paceFraction: 1.5 }, { paceFraction: Number.NaN }, { paceEveryMs: -1 }]) expect(() => new Rig({ timing: bad })).toThrow(RangeError);
  });
});

describe('review 7: the freed window stays small while nobody asks for an estimate', () => {
  it('add prunes: a hundred thousand frees over a day keep a window\'s worth of entries, not all of them', () => {
    const w = new FreedWindow(MIN, 10_000);
    for (let i = 0; i < 100_000; i++) w.add(1, i * 100);
    // 10 per second, a one-minute window: 600 live entries; the dropped ones are compacted away once they outnumber the live ones
    expect(w.retained).toBeLessThan(1_300);
    expect(w.units(100_000 * 100)).toBeGreaterThan(0);
    expect(w.units(100_000 * 100)).toBeLessThanOrEqual(600);
  });

  it('and CapacityAdmission feeds it on every freed call, with an empty queue', () => {
    const r = new Rig({ timing: { estimateWindowMs: MIN } });
    for (let i = 0; i < 5_000; i++) {
      r.now += 100;
      r.adm.freed(1, r.now);
    }
    // an estimate asked for now sees only the last minute's units: 600 freed, so one unit takes 1/600 of the span
    r.sig.set({ cpu: 0.9 });
    r.start('w');
    expect(r.adm.lookup('w', r.now)?.estimatedWaitMs).toBe(Math.ceil((1 / 600) * MIN));
  });
});

describe('review 8: the queue keeps its own copy of a request', () => {
  it('a caller that edits its sessions after asking leaves no ghost: withdraw frees every session that was given', () => {
    const r = busy();
    const sessions = ['alice', 'bob'];
    const addressKeys = ['k1', 'k2'];
    expect(r.adm.request({ ...r.req('T'), sessions, addressKeys }, r.now).kind).toBe('waiting');
    sessions.splice(1, 1); // bob left the table in the caller's own list
    addressKeys.length = 0;
    expect(r.adm.hasWaitingSession('bob')).toBe(true);
    expect(r.adm.withdraw('T', r.now)).toBe(true);
    expect(r.adm.hasWaitingSession('alice')).toBe(false);
    expect(r.adm.hasWaitingSession('bob')).toBe(false);
    // bob is not refused 'session' for ever, and the address keys are free again
    expect(r.ask('U', { sessions: ['bob'], addressKeys: ['k1'] })).toBe('waiting');
    expect(r.ask('V', { sessions: ['x'], addressKeys: ['k2'] })).toBe('waiting');
    expect(r.ask('W', { sessions: ['y'], addressKeys: ['k2'] })).toBe('waiting');
    expect(r.ask('X', { sessions: ['z'], addressKeys: ['k2'] })).toBe('refused');
  });

  it('a caller that reuses its request object for the next table does not change the waiting one', () => {
    const r = busy();
    const req = r.req('T1');
    r.adm.request(req, r.now);
    req.table = 'T2';
    req.sessions.push('intruder');
    expect(r.adm.isWaiting('T1')).toBe(true);
    expect(r.adm.isWaiting('T2')).toBe(false);
    expect(r.adm.hasWaitingSession('intruder')).toBe(false);
  });
});

describe('review 9: the leave metric, the timeout label and the estimate\'s cap', () => {
  it('counts the starts that left the queue before admission, by why: they asked to leave, or their seats changed', () => {
    const r = busy();
    r.start('A');
    r.start('B', { sessions: ['x', 'y'] });
    expect(r.adm.withdraw('A', r.now)).toBe(true);
    r.start('B', { sessions: ['x', 'z'] });
    expect(r.value('openmtg_hosted_capacity_left_total', { reason: 'withdrawn' })).toBe(1);
    expect(r.value('openmtg_hosted_capacity_left_total', { reason: 'seats' })).toBe(1);
    expect(r.adm.stats().left).toBe(2);
  });

  it('a start that waited too long is a refusal with reason capacityTimeout (the label of the other refusals), not a leave', () => {
    const r = busy();
    r.start('A');
    r.go(20 * MIN + 1);
    expect(r.value('openmtg_hosted_refusals_total', { reason: 'capacityTimeout' })).toBe(1);
    expect(r.value('openmtg_hosted_capacity_left_total', { reason: 'withdrawn' })).toBeUndefined();
  });

  it('the estimate never passes the longest wait: 300 waiting and one unit freed is 20 minutes, not 5 hours', () => {
    const r = busy();
    for (let i = 0; i < 300; i++) r.start(`t${i}`);
    r.end(1);
    const max = r.adm.limits.waitMaxMs;
    expect(r.adm.lookup('t299', r.now)?.estimatedWaitMs).toBe(max);
    expect(r.adm.lookup('t0', r.now)?.estimatedWaitMs).toBe(MIN);
    // the same in the decision a new start gets, and in the events
    r.adm.withdraw('t299', r.now);
    expect(waitingOf(r.start('late')).estimatedWaitMs).toBe(max);
    const ev = r.go(6 * SEC);
    for (const e of ev) if (e.kind === 'position') expect(e.estimatedWaitMs).toBeLessThanOrEqual(max);
    expect(estimateWaitMs(300, 1)).toBeGreaterThan(max); // (the contract's function is not capped; the queue caps what it shows)
  });

  it('estimateWaitMs rounds up: a wait is never promised shorter than the arithmetic says', () => {
    expect(estimateWaitMs(1, 7, MIN)).toBe(8_572); // 8571.43
    expect(estimateWaitMs(2, 7, MIN)).toBe(17_143); // 17142.86
    expect(estimateWaitMs(1, 3, 10 * MIN)).toBe(200_000);
    expect(estimateWaitMs(3, 7, MIN)).toBe(25_715); // 25714.29
  });
});

describe('review 10: the interface the gateway is typed with', () => {
  it('capacityState through Admission: queueing while a signal holds starts back (the queue is empty), full while draining', () => {
    const r = new Rig();
    const adm: Admission = r.adm;
    expect(adm.capacityState()).toBe('open');
    r.sig.set({ cpu: 0.9 });
    r.go(SEC);
    expect(adm.size().starts).toBe(0);
    expect(adm.capacityState()).toBe('queueing');
    r.sig.set({ cpu: 0.1, workerHeap: 0.95 });
    r.go(SEC);
    expect(adm.capacityState()).toBe('queueing');
    r.sig.set({ workerHeap: 0.1, store: true });
    r.go(SEC);
    expect(adm.capacityState()).toBe('queueing');
    r.sig.set({ store: false });
    r.go(SEC);
    expect(adm.capacityState()).toBe('open');
    adm.drain();
    expect(adm.capacityState()).toBe('full');
  });

  it('lookup, isWaiting, hasWaitingSession and restore through Admission', () => {
    const r = busy();
    const adm: Admission = r.adm;
    adm.restore([r.req('A', { since: r.now - MIN, sessions: ['alice'] }), r.req('B', { sessions: ['bob'] })], r.now);
    expect(adm.isWaiting('A')).toBe(true);
    expect(adm.hasWaitingSession('bob')).toBe(true);
    expect(adm.lookup('B', r.now)).toMatchObject({ position: 2, unitsAhead: 1 });
    expect(adm.lookup('nobody', r.now)).toBeNull();
  });

  it('the double the gateway\'s tests use answers the widened interface too: open, nothing waiting, restore asks each start', () => {
    const d: Admission = new ImmediateAdmission();
    expect(d.capacityState()).toBe('open');
    expect(d.lookup('t', 0)).toBeNull();
    expect(d.isWaiting('t')).toBe(false);
    expect(d.hasWaitingSession('s')).toBe(false);
    const req: StartRequest = { table: 't', source: 'listed', seats: 2, units: 1, sessions: ['s'], addressKeys: ['k'], since: 0 };
    expect(d.restore([req], 0)).toEqual([{ table: 't', decision: { kind: 'admitted' } }]);
    d.drain();
    expect(d.capacityState()).toBe('full');
  });
});

describe('review 11: nits', () => {
  it('withdraw admits the next head at once; its event is carried to the next tick\'s return (no hook)', () => {
    const r = new Rig({ limits: { capacityUnits: 10 } });
    r.sig.set({ runningUnits: 6 });
    r.start('pod', { seats: 4 });
    r.start('solo');
    expect(r.adm.withdraw('pod', r.now)).toBe(true);
    expect(r.adm.isReserved('solo')).toBe(true);
    expect(r.adm.size()).toEqual({ starts: 0, units: 0, reserved: 1 });
    // returned once: by the next call that returns events, first in its list
    expect(r.tables(r.adm.tick(r.now), 'admitted')).toEqual(['solo']);
    expect(r.tables(r.adm.tick(r.now), 'admitted')).toEqual([]);
  });

  it('with onEvents, the carried events arrive in a microtask, once, and a tick that comes first takes them instead', async () => {
    const got: AdmissionEvent[][] = [];
    const r = new Rig({ limits: { capacityUnits: 10 }, onEvents: (e) => got.push(e) });
    r.sig.set({ runningUnits: 6 });
    r.start('pod', { seats: 4 });
    r.start('solo');
    r.adm.withdraw('pod', r.now);
    expect(got).toEqual([]); // never inside the call that caused them
    await Promise.resolve();
    expect(got).toEqual([[{ kind: 'admitted', table: 'solo' }]]);
    expect(r.adm.tick(r.now)).toEqual([]);

    // a tick before the microtask returns them and the hook has nothing left
    const again: AdmissionEvent[][] = [];
    const q = new Rig({ limits: { capacityUnits: 10 }, onEvents: (e) => again.push(e) });
    q.sig.set({ runningUnits: 6 });
    q.start('pod', { seats: 4 });
    q.start('solo');
    q.adm.withdraw('pod', q.now);
    expect(q.tables(q.adm.tick(q.now), 'admitted')).toEqual(['solo']);
    await Promise.resolve();
    expect(again).toEqual([]);
  });

  it('begun lets the head in when the double count ends: the runtime counts the game while its reservation is still held', async () => {
    const got: AdmissionEvent[][] = [];
    const r = new Rig({ limits: { capacityUnits: 10 }, onEvents: (e) => got.push(e) });
    r.sig.set({ runningUnits: 8 });
    expect(r.ask('A')).toBe('admitted'); // 8 running + 1 reserved
    expect(r.ask('B', { units: 2 })).toBe('waiting'); // 8 + 1 + 2 = 11
    // another game ended (7) and A's game exists (8), admission not told yet: 8 running + A's reservation counts A twice
    r.sig.set({ runningUnits: 8 });
    r.adm.begun('A', r.now);
    expect(got).toEqual([]);
    await Promise.resolve();
    // 8 + 0 + 2 = 10 fits: B is in, without waiting for the next tick
    expect(got).toEqual([[{ kind: 'admitted', table: 'B' }]]);
    expect(r.adm.isReserved('B')).toBe(true);
  });

  it('a start asking again with the same seats while reserved keeps its reservation alive: the safety net starts from now', () => {
    const r = new Rig({ limits: { capacityUnits: 10 } });
    r.sig.set({ runningUnits: 9 });
    expect(r.ask('A')).toBe('admitted'); // lapses at +40 s
    expect(r.ask('B')).toBe('waiting');
    r.go(35 * SEC);
    expect(r.ask('A')).toBe('admitted'); // asks again: lapses at +75 s now
    r.go(6 * SEC); // +41 s: it would have lapsed
    expect(r.adm.isReserved('A')).toBe(true);
    expect(r.tables(r.go(33 * SEC), 'admitted')).toEqual([]);
    expect(r.tables(r.go(2 * SEC), 'admitted')).toEqual(['B']);
    expect(r.adm.isReserved('A')).toBe(false);
  });
});

describe('mutations that survived the first tests', () => {
  it('request lapses stale reservations itself: at +41 s, with 9 of 10 running and no tick, a new start is admitted, not queued', () => {
    const r = new Rig({ limits: { capacityUnits: 10 } });
    r.sig.set({ runningUnits: 9 });
    expect(r.ask('first')).toBe('admitted');
    r.now += 41 * SEC; // the ready check's 30 s and the 10 s grace are over; nobody ticked
    expect(r.ask('second')).toBe('admitted');
    expect(r.adm.size()).toEqual({ starts: 0, units: 0, reserved: 1 });
  });

  it('position events: a start whose place changed by units ahead only (a replacement ahead of it) is told', () => {
    const r = busy();
    r.start('A', { since: r.now - 5 * MIN });
    r.start('C');
    r.adm.withdraw('A', r.now);
    // an older start (restored) of 2 units takes the place ahead of C: C stays 2nd, with 2 units ahead instead of 1
    r.adm.restore([r.req('A2', { units: 2, since: r.now - 9 * MIN })], r.now);
    expect(r.adm.lookup('C', r.now)).toEqual({ position: 2, unitsAhead: 2, estimatedWaitMs: null });
    const ev = r.go(6 * SEC);
    expect(ev.filter((e) => e.kind === 'position' && e.table === 'C')).toEqual([{ kind: 'position', table: 'C', position: 2, unitsAhead: 2, estimatedWaitMs: null }]);
  });

  it('position events: a start whose place changed by position only (two starts ahead replaced by one of the same units) is told', () => {
    const r = busy();
    r.start('A', { since: r.now - 5 * MIN });
    r.start('B', { since: r.now - 5 * MIN });
    r.start('C');
    expect(r.adm.lookup('C', r.now)).toMatchObject({ position: 3, unitsAhead: 2 });
    r.adm.withdraw('A', r.now);
    r.adm.withdraw('B', r.now);
    r.adm.restore([r.req('D', { units: 2, since: r.now - 9 * MIN })], r.now);
    expect(r.adm.lookup('C', r.now)).toEqual({ position: 2, unitsAhead: 2, estimatedWaitMs: null });
    const ev = r.go(6 * SEC);
    expect(ev.filter((e) => e.kind === 'position' && e.table === 'C')).toEqual([{ kind: 'position', table: 'C', position: 2, unitsAhead: 2, estimatedWaitMs: null }]);
  });

  it('the same sessions listed twice are the same seats: the table keeps its place when it asks again', () => {
    const r = busy();
    r.start('T', { sessions: ['a', 'b'] });
    r.start('U');
    expect(waitingOf(r.start('T', { sessions: ['a', 'a', 'b'] }))).toMatchObject({ position: 1 });
    expect(waitingOf(r.start('T', { sessions: ['b', 'a', 'b', 'a'] }))).toMatchObject({ position: 1 });
    expect(r.adm.stats().left).toBe(0);
    expect(r.adm.lookup('U', r.now)).toMatchObject({ position: 2 });
  });

  it('the gauges are current the moment a start is queued (no tick needed)', () => {
    const r = busy();
    r.start('A', { seats: 4 });
    expect(r.value('openmtg_hosted_capacity_queue_starts')).toBe(1);
    expect(r.value('openmtg_hosted_capacity_queue_units')).toBe(5);
    expect(r.value('openmtg_hosted_capacity_head_age_seconds')).toBe(0);
    r.start('B');
    expect(r.value('openmtg_hosted_capacity_queue_starts')).toBe(2);
    expect(r.value('openmtg_hosted_capacity_queue_units')).toBe(6);
  });

  it('moving from one soft signal to another is a debug line; entering and leaving the soft limit are info', () => {
    const r = new Rig();
    r.sig.set({ cpu: 0.8 });
    r.go(SEC);
    r.sig.set({ cpu: 0.1, workerHeap: 0.9 });
    r.go(SEC);
    r.sig.set({ workerHeap: 0.1 });
    r.go(SEC);
    const soft = r.logger.entries().filter((e) => e['event'] === 'capacitySoft').map((e) => [e['signal'], e['level']]);
    expect(soft).toEqual([['cpu', 'info'], ['heap', 'debug'], ['none', 'info']]);
  });

  /** One start at the head; frees at 6 s steps; the position events it gets (after the first, when the estimate appears). */
  function estimateEvents(units: number, frees: number[]): (number | null)[] {
    const r = busy();
    r.start('A', { units });
    const told: (number | null)[] = [];
    for (const f of frees) {
      r.go(6 * SEC);
      for (const e of r.end(f)) if (e.kind === 'position') told.push(e.estimatedWaitMs);
    }
    return told;
  }

  it('an estimate move of 10 s is news (when under a fifth), a move of 5 s is not: the step is 10 s', () => {
    // 1 unit, a 60 s span: 2 freed -> 30 s; 3 -> 20 s (a move of exactly 10 s: news); 4 -> 15 s (a move of 5 s: not)
    expect(estimateEvents(1, [2, 1, 1])).toEqual([30_000, 20_000]);
  });

  it('an estimate move of a fifth is news, less is not: the fraction is 20%', () => {
    // 10 units: 5 freed -> 120 s; 6 -> 100 s (a move of 20 s, under 24 s: not news); 7 -> 85.7 s (34.3 s against the 120 s shown: news)
    expect(estimateEvents(10, [5, 1, 1])).toEqual([120_000, 85_715]);
  });
});

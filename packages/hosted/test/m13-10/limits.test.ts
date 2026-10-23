/**
 * M13-10: the hard limits of design 4.6 (`CAPACITY_QUEUE_MAX`, `CAPACITY_WAIT_MAX_MINUTES`, `serverBusy` with `retryAfterMs`), one waiting start per
 * session and two per address key, and the limits' own configuration (`admissionLimitsOf`, `checkAdmissionLimits`).
 */
import { describe, expect, it } from 'vitest';
import {
  admissionLimitsOf, checkAdmissionLimits, checkAdmissionTiming, DEFAULT_ADMISSION_LIMITS, DEFAULT_ADMISSION_TIMING, startRequestFor, withDefaults, type AdmissionLimits,
} from '../../src/admission';
import { parseConfig } from '../../src/config';
import { MIN, Rig, waitingOf } from './helpers';

/** A server whose CPU is over its soft level: every start waits, whatever the units. */
const busy = (o: ConstructorParameters<typeof Rig>[0] = {}) => {
  const r = new Rig(o);
  r.sig.set({ cpu: 0.9 });
  return r;
};

describe('M13-10: the queue is bounded (CAPACITY_QUEUE_MAX): serverBusy', () => {
  it('300 starts wait; the 301st is refused with serverBusy and retryAfterMs, and is not queued', () => {
    const r = busy();
    for (let i = 1; i <= 300; i++) expect(r.ask(`t${i}`), `t${i}`).toBe('waiting');
    expect(r.adm.size().starts).toBe(300);
    expect(r.adm.capacityState()).toBe('full');
    expect(r.start('t301')).toEqual({ kind: 'refused', reason: 'queueFull', retryAfterMs: DEFAULT_ADMISSION_TIMING.busyRetryAfterMs });
    expect(DEFAULT_ADMISSION_TIMING.busyRetryAfterMs).toBe(120_000);
    expect(r.adm.size().starts).toBe(300);
    expect(r.adm.isWaiting('t301')).toBe(false);
    expect(r.value('openmtg_hosted_refusals_total', { reason: 'queueFull' })).toBe(1);
    expect(r.adm.stats().refused.queueFull).toBe(1);

    // the refusal left nothing behind: its sessions and address are free, and a place opens when one waiting start leaves
    expect(r.adm.withdraw('t7', r.now)).toBe(true);
    expect(r.adm.capacityState()).toBe('queueing');
    expect(waitingOf(r.start('t301')).position).toBe(300);
  });

  it('the limit is configurable, and 0 means: admitted at once under the soft limit, refused otherwise', () => {
    const two = busy({ limits: { queueMax: 2 } });
    expect([two.ask('a'), two.ask('b'), two.ask('c')]).toEqual(['waiting', 'waiting', 'refused']);

    const none = new Rig({ limits: { queueMax: 0 } });
    expect(none.adm.capacityState()).toBe('open');
    expect(none.ask('under the soft limit')).toBe('admitted');
    none.sig.set({ cpu: 0.9 });
    expect(none.adm.capacityState()).toBe('open'); // not yet read: the state is as of the last reading
    expect(none.ask('over it')).toBe('refused');
    expect(none.adm.capacityState()).toBe('full');
  });

  it('a start admitted at once never counts against the limit, and neither do reserved starts', () => {
    const r = new Rig({ limits: { queueMax: 1 } });
    for (let i = 0; i < 20; i++) expect(r.ask(`t${i}`)).toBe('admitted');
    expect(r.adm.size()).toEqual({ starts: 0, units: 0, reserved: 20 });
  });

  it('is refused with retryAfterMs: the time is configurable', () => {
    const r = busy({ limits: { queueMax: 0 }, timing: { busyRetryAfterMs: 90_000 } });
    expect(r.start('t')).toEqual({ kind: 'refused', reason: 'queueFull', retryAfterMs: 90_000 });
  });
});

describe('M13-10: waiting is bounded (CAPACITY_WAIT_MAX_MINUTES)', () => {
  it('a start that waited past 20 minutes is removed: 20 minutes exactly is still allowed', () => {
    const r = busy();
    const t0 = r.now;
    r.start('A');
    r.go(20 * MIN);
    expect(r.now - t0).toBe(20 * MIN);
    expect(r.adm.isWaiting('A')).toBe(true);
    const ev = r.go(1);
    expect(ev).toEqual([{ kind: 'expired', table: 'A', retryAfterMs: 120_000 }]);
    expect(ev[0]).not.toHaveProperty('cause');
    expect(r.adm.isWaiting('A')).toBe(false);
    expect(r.adm.size()).toEqual({ starts: 0, units: 0, reserved: 0 });
    expect(r.value('openmtg_hosted_refusals_total', { reason: 'capacityTimeout' })).toBe(1);
    // (a start that waited too long is not one that left: that is capacityLeft's)
    expect(r.value('openmtg_hosted_capacity_left_total', { reason: 'withdrawn' })).toBeUndefined();
    expect(r.adm.stats().expired).toBe(1);
    // the sessions are free again: the table may ask again (it goes back to the lobby and, when full, to the back)
    expect(r.ask('A')).toBe('waiting');
  });

  it('removes starts in the order they began waiting, each at its own time', () => {
    const r = busy({ limits: { waitMaxMs: 10 * MIN } });
    r.start('A');
    r.go(3 * MIN);
    r.start('B');
    r.go(3 * MIN);
    r.start('C');
    expect(r.tables(r.go(4 * MIN + 1), 'expired')).toEqual(['A']);
    expect(r.tables(r.go(3 * MIN), 'expired')).toEqual(['B']);
    expect(r.tables(r.go(3 * MIN), 'expired')).toEqual(['C']);
    expect(r.adm.size().starts).toBe(0);
  });

  it('an expired pod at the head lets the 1v1 starts behind it fit in the same step', () => {
    const r = new Rig({ limits: { capacityUnits: 10, waitMaxMs: 5 * MIN } });
    r.sig.set({ runningUnits: 6 });
    r.start('pod', { seats: 4 });
    r.go(MIN);
    r.start('solo1');
    r.start('solo2');
    const ev = r.go(4 * MIN + 1);
    expect(ev.filter((e) => e.kind !== 'position')).toEqual([
      { kind: 'expired', table: 'pod', retryAfterMs: 120_000 },
      { kind: 'admitted', table: 'solo1' },
      { kind: 'admitted', table: 'solo2' },
    ]);
  });

  it('the wait is measured from `since`: a start older than the maximum is removed at the next step', () => {
    const r = busy();
    r.adm.request(r.req('old', { since: r.now - 21 * MIN }), r.now);
    expect(r.adm.isWaiting('old')).toBe(true);
    expect(r.tables(r.go(0), 'expired')).toEqual(['old']);
  });
});

describe('M13-10: one waiting start per session, two per address key', () => {
  it('refuses a start with a session that already has a start waiting, and frees the session when that start goes', () => {
    const r = busy();
    expect(r.ask('A', { sessions: ['alice', 'bob'] })).toBe('waiting');
    expect(r.start('B', { sessions: ['bob', 'carol'] })).toEqual({ kind: 'refused', reason: 'session', retryAfterMs: 0 });
    expect(r.adm.isWaiting('B')).toBe(false);
    expect(r.adm.hasWaitingSession('bob')).toBe(true);
    expect(r.adm.hasWaitingSession('carol')).toBe(false);
    expect(r.ask('C', { sessions: ['carol', 'dave'] })).toBe('waiting');
    expect(r.value('openmtg_hosted_refusals_total', { reason: 'session' })).toBe(1);

    expect(r.adm.withdraw('A', r.now)).toBe(true);
    expect(r.adm.hasWaitingSession('bob')).toBe(false);
    expect(r.ask('B', { sessions: ['bob', 'erin'] })).toBe('waiting');
  });

  it('refuses a third waiting start for an address key; one start counts once for a key however many of its seats share it', () => {
    const r = busy();
    expect(r.ask('A', { addressKeys: ['k'] })).toBe('waiting');
    expect(r.ask('B', { addressKeys: ['k'] })).toBe('waiting');
    expect(r.start('C', { addressKeys: ['k'] })).toEqual({ kind: 'refused', reason: 'address', retryAfterMs: 0 });
    // one key over its limit refuses the whole start, whichever other keys it has
    expect(r.ask('D', { addressKeys: ['z', 'k'] })).toBe('refused');
    expect(r.adm.isWaiting('D')).toBe(false);
    expect(r.ask('E', { addressKeys: ['z'] })).toBe('waiting');
    // a pod whose four players share one address is one waiting start for it
    expect(r.ask('pod', { seats: 4, addressKeys: ['m', 'm', 'm', 'm'] })).toBe('waiting');
    expect(r.ask('F', { addressKeys: ['m'] })).toBe('waiting');
    expect(r.ask('G', { addressKeys: ['m'] })).toBe('refused');
    expect(r.value('openmtg_hosted_refusals_total', { reason: 'address' })).toBe(3);

    // a slot opens when a start leaves, is admitted or expires
    expect(r.adm.withdraw('pod', r.now)).toBe(true);
    expect(r.ask('G', { addressKeys: ['m'] })).toBe('waiting');
    r.sig.set({ cpu: 0.1 });
    expect(r.tables(r.go(1_000), 'admitted').length).toBe(5);
    expect(r.ask('H', { addressKeys: ['k'] })).toBe('admitted');
  });

  it('starts admitted at once never count: an address may start any number of games under the soft limit', () => {
    const r = new Rig();
    for (let i = 0; i < 6; i++) expect(r.ask(`t${i}`, { addressKeys: ['same'] })).toBe('admitted');
  });

  it('checks the session before the address and the address before the queue limit, and draining before all of them', () => {
    const r = busy({ limits: { queueMax: 1, perAddress: 1 } });
    expect(r.ask('A', { sessions: ['s1'], addressKeys: ['k'] })).toBe('waiting');
    expect(r.start('B', { sessions: ['s1'], addressKeys: ['k'] })).toMatchObject({ reason: 'session' });
    expect(r.start('C', { sessions: ['s2'], addressKeys: ['k'] })).toMatchObject({ reason: 'address' });
    expect(r.start('D', { sessions: ['s3'], addressKeys: ['j'] })).toMatchObject({ reason: 'queueFull' });
    r.adm.drain();
    expect(r.start('E', { sessions: ['s1'], addressKeys: ['k'] })).toMatchObject({ reason: 'draining' });
  });
});

describe('M13-10: the limits and their configuration', () => {
  it('the limits of the design are the defaults, and `withDefaults` fills the rest (the units one by one)', () => {
    expect(withDefaults()).toEqual(DEFAULT_ADMISSION_LIMITS);
    expect(withDefaults({ queueMax: 5, units: { two: 1, three: 3, four: 4 } })).toMatchObject({ queueMax: 5, capacityUnits: 900, units: { two: 1, three: 3, four: 4 } });
    expect(withDefaults({ units: { four: 6 } as AdmissionLimits['units'] }).units).toEqual({ two: 1, three: 4, four: 6 });
  });

  it('follow CAPACITY_UNITS, CAPACITY_QUEUE_MAX, CAPACITY_WAIT_MAX_MINUTES and UNITS_* from the configuration', () => {
    const parsed = parseConfig({}, { cpus: 8 });
    if (!parsed.ok) throw new Error(parsed.errors.join('\n'));
    expect(admissionLimitsOf(parsed.config)).toEqual(DEFAULT_ADMISSION_LIMITS);

    const set = parseConfig({ CAPACITY_UNITS: '50', CAPACITY_QUEUE_MAX: '7', CAPACITY_WAIT_MAX_MINUTES: '3', UNITS_POD3: '3', UNITS_POD4: '4' }, { cpus: 8 });
    if (!set.ok) throw new Error(set.errors.join('\n'));
    const l = admissionLimitsOf(set.config);
    expect(l).toMatchObject({ capacityUnits: 50, queueMax: 7, waitMaxMs: 3 * MIN, units: { two: 1, three: 3, four: 4 }, cpuSoft: 0.75, p95SoftMs: 100 });
    expect(() => checkAdmissionLimits(l)).not.toThrow();
    // the starts' units follow the configured weights
    expect(startRequestFor({ table: 't', source: 'listed', seats: 4, sessions: [], addressKeys: [], since: 0 }, l.units).units).toBe(4);
  });

  it('refuses timing that cannot be right, with a RangeError naming the figure', () => {
    for (const [name, value] of [
      ['readyCheckTableMs', 0], ['readyCheckMatchMs', -1], ['estimateWindowMs', 0], ['estimateMinWindowMs', Number.NaN], ['startGraceMs', -1],
      ['busyRetryAfterMs', -5], ['drainRetryAfterMs', Number.POSITIVE_INFINITY], ['positionEveryMs', -1],
    ] as const) {
      expect(() => new Rig({ timing: { [name]: value } }), name).toThrow(new RegExp(name));
      expect(() => checkAdmissionTiming({ ...DEFAULT_ADMISSION_TIMING, [name]: value }), name).toThrow(RangeError);
    }
    expect(() => checkAdmissionTiming(DEFAULT_ADMISSION_TIMING)).not.toThrow();
    expect(() => new Rig({ timing: { startGraceMs: 0, positionEveryMs: 0 } })).not.toThrow();
  });

  it('refuses limits that cannot be right, with a RangeError naming the limit', () => {
    const bad: [Partial<AdmissionLimits>, RegExp][] = [
      [{ capacityUnits: 0 }, /capacityUnits/],
      [{ capacityUnits: 1.5 }, /capacityUnits/],
      [{ units: { two: 0, three: 4, four: 5 } }, /units\.two/],
      [{ units: { two: 5, three: 4, four: 5 } }, /units must not shrink/],
      [{ units: { two: 1, three: 6, four: 5 } }, /units must not shrink/],
      [{ cpuSoft: 0 }, /cpuSoft/],
      [{ cpuSoft: 1.2 }, /cpuSoft/],
      [{ heapSoft: -1 }, /heapSoft/],
      [{ outboundSoft: Number.NaN }, /outboundSoft/],
      [{ p95SoftMs: 0 }, /p95SoftMs/],
      [{ queueMax: -1 }, /queueMax/],
      [{ queueMax: 2.5 }, /queueMax/],
      [{ waitMaxMs: 0 }, /waitMaxMs/],
      [{ perAddress: 0 }, /perAddress/],
    ];
    for (const [l, re] of bad) {
      expect(() => checkAdmissionLimits(withDefaults(l)), JSON.stringify(l)).toThrow(RangeError);
      expect(() => checkAdmissionLimits(withDefaults(l)), JSON.stringify(l)).toThrow(re);
      expect(() => new Rig({ limits: l }), JSON.stringify(l)).toThrow(re);
    }
    expect(() => checkAdmissionLimits(DEFAULT_ADMISSION_LIMITS)).not.toThrow();
    // a pod larger than the capacity is not a configuration error here (config.ts refuses it): its starts are refused (queue.test.ts)
    expect(() => new Rig({ limits: { capacityUnits: 3 } })).not.toThrow();
  });
});

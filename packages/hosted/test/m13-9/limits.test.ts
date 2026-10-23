/**
 * Limits (design 4.5, D6): a session is in at most one queue and not at a table at the same time; at most 2 queue entries per address key; a cooldown
 * after missed ready checks; the queue must be one the server offers. Every refusal leaves the matcher as it was.
 */
import { describe, expect, it } from 'vitest';
import { HOSTED_FORMATS } from '../../src/api';
import { DEFAULT_MATCH_POLICY, FifoMatcher, isQueueKey, matchPolicyFor, offeredQueues, type MatchEntry, type QueueKey } from '../../src/match';
import { DUEL, MIN, PAUPER, pairs, POD, Rig, SEC, STANDARD } from './helpers';

describe('M13-9: one queue, never at a table', () => {
  it('a session already queued is refused, in the same queue or another; its entry stays as it was', () => {
    const r = new Rig();
    expect(r.join('a')).toBeNull();
    expect(r.join('a')).toBe('inQueue');
    expect(r.join('a', { key: PAUPER })).toBe('inQueue');
    expect(r.matcher.queued('a')).toEqual(STANDARD);
    expect(r.matcher.status(STANDARD, r.now).waiting).toBe(1);
    expect(r.matcher.status(PAUPER, r.now).waiting).toBe(0);
  });

  it('a session at a table, or with a start waiting for capacity, cannot queue (the lookup is asked at enter)', () => {
    const r = new Rig();
    r.busy.add('a');
    expect(r.join('a')).toBe('atTable');
    expect(r.matcher.queued('a')).toBeNull();
    r.busy.delete('a');
    expect(r.join('a')).toBeNull();
  });

  it('leaving: true once, false for a session that is not queued; it can queue again at once', () => {
    const r = new Rig();
    r.join('a');
    expect(r.matcher.leave('a')).toBe(true);
    expect(r.matcher.leave('a')).toBe(false);
    expect(r.matcher.leave('nobody')).toBe(false);
    expect(r.matcher.queued('a')).toBeNull();
    expect(r.join('a', { key: PAUPER })).toBeNull();
    expect(r.matcher.queued('a')).toEqual(PAUPER);
  });

  it('queued() gives a copy of the key: changing it changes nothing in the queue', () => {
    const r = new Rig();
    r.join('a');
    const k = r.matcher.queued('a')! as { format: string };
    k.format = 'modern';
    expect(r.matcher.queued('a')).toEqual(STANDARD);
  });
});

describe('M13-9: at most 2 entries per address key', () => {
  it('the third entry of an address key is refused, whatever the queue; leaving or being matched frees a place', () => {
    const r = new Rig();
    expect(r.join('a', { address: 'x' })).toBeNull();
    expect(r.join('b', { address: 'x', key: PAUPER })).toBeNull();
    expect(r.join('c', { address: 'x', key: DUEL })).toBe('address');
    expect(r.matcher.queued('c')).toBeNull();
    // another address key is not affected
    expect(r.join('d', { address: 'y' })).toBeNull();
    // leaving frees one
    r.matcher.leave('b');
    expect(r.join('c', { address: 'x', key: DUEL })).toBeNull();
    expect(r.join('e', { address: 'x' })).toBe('address');
    // being matched frees them too: a (standard, x) and d (standard, y) are matched
    expect(pairs(r.tick())).toEqual(['a+d']);
    expect(r.join('e', { address: 'x' })).toBeNull();
  });

  it('the limit is the policy\'s', () => {
    const r = new Rig({ policy: { perAddress: 1 } });
    expect(r.join('a', { address: 'x' })).toBeNull();
    expect(r.join('b', { address: 'x' })).toBe('address');
  });

  it('entries put back by a failed ready check count again, and are never refused', () => {
    const r = new Rig();
    r.join('x1', { address: 'x' });
    r.join('x2', { address: 'x' });
    const [m] = r.tick();
    // x1 and x2 are in a ready check, out of the queue: two new sessions of the same address key may queue...
    expect(r.join('x3', { address: 'x' })).toBeNull();
    expect(r.join('x4', { address: 'x' })).toBeNull();
    expect(r.join('x5', { address: 'x' })).toBe('address');
    // ...and the two confirmers go back in all the same: nobody loses their place (a limit on `enter` only)
    r.matcher.requeueFront(m!.entries, r.now);
    expect(r.matcher.status(STANDARD, r.now).waiting).toBe(4);
    expect(r.join('x5', { address: 'x' })).toBe('address');
  });
});

describe('M13-9: cooldown after missed ready checks', () => {
  it('refuses with `cooldown` while it lasts (2 minutes after the second miss in 10 minutes)', () => {
    const r = new Rig();
    r.matcher.missed('a', r.now);
    expect(r.join('a')).toBeNull(); // one miss: no cooldown
    r.matcher.leave('a');
    r.advance(MIN);
    r.matcher.missed('a', r.now); // the second within 10 minutes
    expect(r.matcher.cooldownLeftMs('a', r.now)).toBe(2 * MIN);
    expect(r.join('a')).toBe('cooldown');
    expect(r.advance(2 * MIN - 1).join('a')).toBe('cooldown');
    expect(r.matcher.cooldownLeftMs('a', r.now)).toBe(1);
    expect(r.advance(1).join('a')).toBeNull();
    expect(r.matcher.cooldownLeftMs('a', r.now)).toBe(0);
    // nobody else is affected
    expect(r.join('b')).toBeNull();
  });
});

describe('M13-9: queues that are not offered', () => {
  it('a queue the lookup does not offer (a pod queue with pods off, a format the server does not host) is refused', () => {
    const r = new Rig({ offered: (k) => k.size === 2 && k.format !== 'vintage' });
    expect(r.join('a', { key: POD })).toBe('notOffered');
    expect(r.join('b', { key: { format: 'vintage', size: 2 } })).toBe('notOffered');
    expect(r.join('c', { key: { format: 'standard', size: 2 } })).toBeNull();
    expect(r.matcher.queued('a')).toBeNull();
    expect(r.matcher.status(POD, r.now).waiting).toBe(0);
  });

  it('a key that is not a queue is refused even when the lookup says yes: no pod queue of a 1v1 format, no size 3, no unknown format', () => {
    const r = new Rig({ offered: () => true });
    const keys: unknown[] = [
      { format: 'standard', size: 'pod' },
      { format: 'duel', size: 'pod' },
      { format: 'commander', size: 3 },
      { format: 'commander', size: 4 },
      { format: 'commander', size: '2' },
      { format: 'edh', size: 2 },
      { format: 'standard' },
    ];
    for (const key of keys) {
      expect(r.matcher.enter({ ...r.entry('a'), key: key as QueueKey }, r.now), JSON.stringify(key)).toBe('notOffered');
    }
    expect(r.matcher.queued('a')).toBeNull();
  });

  it('the pod formats are Commander, Brawl and Standard Brawl; every format has its 1v1 queue', () => {
    const podFormats = HOSTED_FORMATS.filter((f) => isQueueKey({ format: f.id, size: 'pod' })).map((f) => f.id);
    expect(podFormats).toEqual(['commander', 'brawl', 'standardbrawl']);
    for (const f of HOSTED_FORMATS) expect(isQueueKey({ format: f.id, size: 2 })).toBe(true);
    expect(isQueueKey(null)).toBe(false);
    expect(isQueueKey('commander/pod')).toBe(false);
  });

  it('offeredQueues: the server\'s formats, and pods only with PODS_ENABLED', () => {
    const off = offeredQueues({ formats: ['standard', 'commander'], podsEnabled: false });
    expect(off({ format: 'standard', size: 2 })).toBe(true);
    expect(off({ format: 'commander', size: 2 })).toBe(true);
    expect(off({ format: 'commander', size: 'pod' })).toBe(false); // pods are off until M13-16
    expect(off({ format: 'pauper', size: 2 })).toBe(false); // not one of the server's formats
    const on = offeredQueues({ formats: ['standard', 'commander', 'brawl'], podsEnabled: true });
    expect(on({ format: 'commander', size: 'pod' })).toBe(true);
    expect(on({ format: 'brawl', size: 'pod' })).toBe(true);
    expect(on({ format: 'standard', size: 'pod' })).toBe(false); // a 1v1 format has no pod queue
    expect(on({ format: 'standardbrawl', size: 'pod' })).toBe(false); // pod format, but not one of the server's
  });

  it('matchPolicyFor: the design\'s policy with the configured pod wait', () => {
    expect(matchPolicyFor({ podThreeAfterSeconds: 90 })).toEqual(DEFAULT_MATCH_POLICY);
    expect(matchPolicyFor({ podThreeAfterSeconds: 30 })).toEqual({ ...DEFAULT_MATCH_POLICY, podThreeAfterMs: 30 * SEC });
  });
});

describe('M13-9: which refusal comes first', () => {
  it('already queued, at a table, address key, cooldown, not offered: in that order', () => {
    const r = new Rig({ offered: (k) => k.format !== 'vintage' });
    const vintage: QueueKey = { format: 'vintage', size: 2 };
    r.join('f1', { address: 'full' });
    r.join('f2', { address: 'full' });
    for (const s of ['b', 'c', 'd']) {
      r.matcher.missed(s, r.now);
      r.matcher.missed(s, r.now);
    }
    // queued and busy and everything else
    r.join('a');
    r.busy.add('a');
    expect(r.join('a', { address: 'full', key: vintage })).toBe('inQueue');
    r.busy.add('b');
    expect(r.join('b', { address: 'full', key: vintage })).toBe('atTable');
    expect(r.join('c', { address: 'full', key: vintage })).toBe('address');
    expect(r.join('d', { key: vintage })).toBe('cooldown');
    expect(r.join('e', { key: vintage })).toBe('notOffered');
  });
});

describe('M13-9: bad input is a programming error, never a silent refusal', () => {
  const rig = new Rig();
  const ok = rig.entry('a');
  const bad: [string, unknown][] = [
    ['a missing session', { ...ok, session: '' }],
    ['a session that is not a string', { ...ok, session: 7 }],
    ['an empty address key', { ...ok, addressKey: '' }],
    ['no deck handle', { ...ok, deck: undefined }],
    ['an enteredAt that is not finite', { ...ok, enteredAt: Number.NaN }],
    ['no key', { ...ok, key: null }],
    ['recent opponents that are not a list', { ...ok, recentOpponents: 'b' }],
    ['recent opponents that are not sessions', { ...ok, recentOpponents: [1] }],
    ['not an object', null],
  ];

  it.each(bad)('enter: %s throws a TypeError and queues nothing', (_name, e) => {
    const r = new Rig();
    expect(() => r.matcher.enter(e as MatchEntry, r.now)).toThrow(TypeError);
    expect(r.matcher.status(STANDARD, r.now).waiting).toBe(0);
  });

  it('requeueFront: an entry for no queue throws before any entry goes in', () => {
    const r = new Rig();
    const good = r.entry('a');
    expect(() => r.matcher.requeueFront([good, { ...r.entry('b'), key: { format: 'standard', size: 'pod' } }], r.now)).toThrow(TypeError);
    expect(r.matcher.queued('a')).toBeNull();
  });

  it('the constructor checks its context and policy, and keeps its own copy of the policy', () => {
    const ctx = { sessionBusy: () => false, offered: () => true };
    expect(() => new FifoMatcher({ ...ctx, sessionBusy: undefined as never, policy: DEFAULT_MATCH_POLICY })).toThrow(TypeError);
    expect(() => new FifoMatcher({ ...ctx, policy: { ...DEFAULT_MATCH_POLICY, perAddress: 0 } })).toThrow(RangeError);
    expect(() => new FifoMatcher({ ...ctx, policy: { ...DEFAULT_MATCH_POLICY, missedChecks: 1.5 } })).toThrow(RangeError);
    expect(() => new FifoMatcher({ ...ctx, policy: { ...DEFAULT_MATCH_POLICY, rematchAfterMs: Number.NaN } })).toThrow(RangeError);
    expect(() => new FifoMatcher({ ...ctx, policy: { ...DEFAULT_MATCH_POLICY, podFill: 3 as 4 } })).toThrow(RangeError);
    const policy = { ...DEFAULT_MATCH_POLICY };
    const m = new FifoMatcher({ ...ctx, policy });
    policy.perAddress = 0; // changed later: changes nothing
    expect(m.enter(rig.entry('x'), 0)).toBeNull();
  });
});

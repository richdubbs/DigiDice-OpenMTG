/**
 * M15-4: the queue itself (design 9.1, 9.5, 9.7, 13.5, 17.7): every refusal of `enter` and their order; `queued`, `leave`, `missed`,
 * `accounts(ladder)` oldest first; `status` (m13's rounded count and the estimate from the recent match rate); malformed input; the policy copy.
 */
import { describe, expect, it } from 'vitest';
import { DEFAULT_RANKED_POLICY, type RankedMatcherContext } from '../../src/match/api';
import { createRatedMatcher } from '../../src/match/index';
import { estimateQueueWaitMs, MATCH_RATE_WINDOW_MS, roundedWaiting } from '../../src/match/status';
import { acc, entry, harness, MIN, num, POD, SEC } from './helpers';

describe('M15-4: enter and its refusals (9.1)', () => {
  it('inQueue: the account is in any ranked queue already, or the session is', () => {
    const h = harness();
    const t = h.clock.now();
    h.join(1, 1500);
    expect(h.m.enter(entry(1, 1500, t), t)).toBe('inQueue');
    expect(h.m.enter(entry(1, 1500, t, POD), t)).toBe('inQueue');
    expect(h.m.enter(entry(2, 1500, t, { session: 's1' }), t)).toBe('inQueue');
    expect(h.m.queued(acc(1))).toBe('1v1-standard');
  });

  it('atTable: hosted\'s sessionBusy (seated, waiting for capacity, or queued unranked, 9.7)', () => {
    const h = harness();
    h.busySessions.add('s1');
    expect(h.m.enter(entry(1, 1500, h.clock.now()), h.clock.now())).toBe('atTable');
    h.busySessions.delete('s1');
    expect(h.m.enter(entry(1, 1500, h.clock.now()), h.clock.now())).toBeNull();
  });

  it('inRankedGame: a running ranked game (accountBusy)', () => {
    const h = harness();
    h.busyAccounts.add(acc(1));
    expect(h.m.enter(entry(1, 1500, h.clock.now()), h.clock.now())).toBe('inRankedGame');
  });

  it('address: two entries from the address key already, across the ranked queues; a free slot after one leaves', () => {
    const h = harness();
    const t = h.clock.now();
    h.join(1, 1500, { addressKey: 'home' });
    h.join(2, 1500, { ...POD, addressKey: 'home' });
    expect(h.m.enter(entry(3, 1500, t, { addressKey: 'home', ladder: '1v1-pioneer' }), t)).toBe('address');
    expect(h.m.leave(acc(2))).toBe(true);
    expect(h.m.enter(entry(3, 1500, t, { addressKey: 'home', ladder: '1v1-pioneer' }), t)).toBeNull();
  });

  it('address: perAddress from the policy', () => {
    const h = harness({ perAddress: 1 });
    const t = h.clock.now();
    h.join(1, 1500, { addressKey: 'home' });
    expect(h.m.enter(entry(2, 1500, t, { addressKey: 'home' }), t)).toBe('address');
  });

  it('cooldown: the service\'s ranked-queue cooldown at `now` (8.6)', () => {
    const h = harness();
    const t = h.clock.now();
    h.cooling.set(acc(1), t + 5 * MIN);
    expect(h.m.enter(entry(1, 1500, t), t)).toBe('cooldown');
    expect(h.m.enter(entry(1, 1500, t + 5 * MIN), t + 5 * MIN)).toBeNull();
  });

  it('notOffered: the ladder is off, or no ladder at all', () => {
    const h = harness();
    const t = h.clock.now();
    h.off.add('pod-commander');
    expect(h.m.enter(entry(1, 1500, t, POD), t)).toBe('notOffered');
    expect(h.m.enter(entry(2, 1500, t, { ladder: '1v1-standard-bo3' as never }), t)).toBe('notOffered');
    expect(h.m.enter(entry(3, 1500, t, { ladder: '1v1-pauper' }), t)).toBeNull();
  });

  it('refusals come in the order inQueue, atTable, inRankedGame, address, cooldown, notOffered', () => {
    const h = harness({ perAddress: 1 });
    const t = h.clock.now();
    h.join(9, 1500, { addressKey: 'home' });
    h.join(1, 1500, { ladder: '1v1-pioneer' });
    const e = entry(1, 1500, t, { addressKey: 'home', ladder: 'pod-commander' });
    h.off.add('pod-commander');
    h.cooling.set(acc(1), t + MIN);
    h.busyAccounts.add(acc(1));
    h.busySessions.add('s1');
    const order: (string | null)[] = [];
    order.push(h.m.enter(e, t));
    h.m.leave(acc(1));
    order.push(h.m.enter(e, t));
    h.busySessions.clear();
    order.push(h.m.enter(e, t));
    h.busyAccounts.clear();
    order.push(h.m.enter(e, t));
    h.m.leave(acc(9));
    order.push(h.m.enter(e, t));
    h.cooling.clear();
    order.push(h.m.enter(e, t));
    h.off.clear();
    order.push(h.m.enter(e, t));
    expect(order).toEqual(['inQueue', 'atTable', 'inRankedGame', 'address', 'cooldown', 'notOffered', null]);
  });

  it('a malformed entry is a TypeError and changes nothing', () => {
    const h = harness();
    const t = h.clock.now();
    for (const bad of [
      { ...entry(1, 1500, t), rating: Number.NaN },
      { ...entry(1, 1500, t), enteredAt: Infinity },
      { ...entry(1, 1500, t), account: '' },
      { ...entry(1, 1500, t), placement: 'no' },
      { ...entry(1, 1500, t), recent: [acc(2)] },
      null,
    ]) {
      expect(() => h.m.enter(bad as never, t)).toThrow(TypeError);
    }
    expect(h.m.queued(acc(1))).toBeNull();
    expect(h.m.enter(entry(1, 1500, t), t)).toBeNull();
  });

  it('the matcher keeps its own copy of an entry: changing the caller\'s object later changes nothing', () => {
    const h = harness();
    const t = h.clock.now();
    const a = entry(1, 1500, t);
    const b = entry(2, 1900, t);
    h.m.enter(a, t);
    h.m.enter(b, t);
    b.rating = 1510;
    expect(h.tick()).toEqual([]);
  });
});

describe('M15-4: queued, leave, missed and accounts(ladder)', () => {
  it('accounts(ladder) lists a ladder\'s queue oldest first (enteredAt, then account id), whatever the order of entering', () => {
    const h = harness();
    const t = h.clock.now();
    h.join(5, 1500, { enteredAt: t + 2 });
    h.join(4, 1500, { enteredAt: t });
    h.join(3, 1500, { enteredAt: t + 1 });
    h.join(2, 1500, { enteredAt: t });
    h.join(7, 1500, POD);
    expect(h.waiting()).toEqual([2, 4, 3, 5]);
    expect(h.waiting('pod-commander')).toEqual([7]);
    expect(h.waiting('1v1-pauper')).toEqual([]);
  });

  it('leave says whether the account was queued; missed drops the entry; both free the session and the address slot', () => {
    const h = harness({ perAddress: 1 });
    const t = h.clock.now();
    h.join(1, 1500, { addressKey: 'home' });
    h.join(2, 1500);
    expect(h.m.leave(acc(1))).toBe(true);
    expect(h.m.leave(acc(1))).toBe(false);
    expect(h.m.queued(acc(1))).toBeNull();
    h.m.missed(acc(2), t);
    expect(h.m.queued(acc(2))).toBeNull();
    expect(h.waiting()).toEqual([]);
    expect(h.m.enter(entry(3, 1500, t, { addressKey: 'home', session: 's1' }), t)).toBeNull();
    expect(h.m.enter(entry(4, 1500, t, { session: 's2' }), t)).toBeNull();
    h.m.missed(acc(99), t); // nobody: nothing happens
    expect(h.waiting()).toEqual([3, 4]);
  });
});

describe('M15-4: status (9.5)', () => {
  it('roundedWaiting is m13\'s: 0-5 as they are, to the nearest 5 up to 50, then to the nearest 10', () => {
    expect([0, 1, 5, 6, 7, 8, 12, 50, 51, 55, 123].map(roundedWaiting)).toEqual([0, 1, 5, 5, 5, 10, 10, 50, 50, 60, 120]);
  });

  it('the estimate: ceil(max(1, waiting) / players matched in the last 10 minutes · 10 minutes); null when nobody was matched', () => {
    expect(estimateQueueWaitMs(3, 0)).toBeNull();
    expect(estimateQueueWaitMs(0, 20)).toBe(30 * SEC);
    expect(estimateQueueWaitMs(4, 20)).toBe(2 * MIN);
    expect(estimateQueueWaitMs(1, 3)).toBe(Math.ceil(MATCH_RATE_WINDOW_MS / 3));
  });

  it('counts the ladder\'s queue, rounded, and estimates from its matches of the last 10 minutes only; never who', () => {
    const h = harness();
    const t0 = h.clock.now();
    for (let n = 1; n <= 7; n++) h.join(n, 1000 + 300 * n); // nobody within anybody's window
    expect(h.m.status('1v1-standard', t0)).toEqual({ waiting: 5, estimatedWaitMs: null });
    h.join(8, 1300 + 10); // next to account 1
    h.join(9, 1600 + 10); // next to account 2
    expect(h.tick().map((m) => m.entries.map((e) => num(e.account)))).toEqual([[1, 8], [2, 9]]);
    expect(h.m.status('1v1-standard', t0)).toEqual({ waiting: 5, estimatedWaitMs: estimateQueueWaitMs(5, 4) });
    expect(h.m.status('1v1-pioneer', t0)).toEqual({ waiting: 0, estimatedWaitMs: null });
    expect(h.m.status('nope' as never, t0)).toEqual({ waiting: 0, estimatedWaitMs: null });
    expect(Object.keys(h.m.status('1v1-standard', t0)).sort()).toEqual(['estimatedWaitMs', 'waiting']);
    h.clock.set(t0 + 10 * MIN - 1);
    expect(h.m.status('1v1-standard', h.clock.now()).estimatedWaitMs).toBe(estimateQueueWaitMs(5, 4));
    h.clock.set(t0 + 10 * MIN);
    expect(h.m.status('1v1-standard', h.clock.now()).estimatedWaitMs).toBeNull();
    h.tick(); // everyone has waited 10 minutes and is matched; the old log is gone either way
    expect(h.m.status('1v1-standard', h.clock.now()).waiting).toBeLessThan(5);
  });
});

describe('M15-4: the context and the policy', () => {
  const ctx = (policy: unknown): RankedMatcherContext => ({
    sessionBusy: () => false, accountBusy: () => false, cooldown: () => false, offered: () => true, newMatchId: () => 'm', policy: policy as never,
  });

  it('a bad policy or context is refused at creation', () => {
    expect(() => createRatedMatcher(ctx({ ...DEFAULT_RANKED_POLICY, windowCap1v1: -1 }))).toThrow(/windowCap1v1/);
    expect(() => createRatedMatcher(ctx({ ...DEFAULT_RANKED_POLICY, perAddress: 0 }))).toThrow(/perAddress/);
    expect(() => createRatedMatcher(ctx(null))).toThrow(RangeError);
    expect(() => createRatedMatcher({ ...ctx(DEFAULT_RANKED_POLICY), newMatchId: undefined as never })).toThrow(/newMatchId/);
  });

  it('the policy is read once: changing the context\'s object later changes nothing', () => {
    const policy = { ...DEFAULT_RANKED_POLICY };
    const m = createRatedMatcher(ctx(policy));
    const t = 1_000_000;
    m.enter(entry(1, 1500, t), t);
    policy.windowStart = 1000;
    expect(m.window(acc(1), t)).toBe(100);
  });
});

/**
 * Restart (design 4.5): the queues are in memory. A drain empties them and hands the gateway the queued entries, so each session gets its `queueLost`
 * notice; a restarted server starts with empty queues, and the players queue again with one click (their decks are checked again).
 */
import { describe, expect, it } from 'vitest';
import { NOTICE_KINDS } from '../../src/api';
import { DEFAULT_MATCH_POLICY, FifoMatcher, type MatchEntry } from '../../src/match';
import { DUEL, pairs, POD, Rig, SEC, STANDARD } from './helpers';

describe('M13-9: drain and restart', () => {
  it('a drain returns every queued entry, oldest first, so each session can get its queueLost notice', () => {
    const r = new Rig();
    r.join('a');
    r.advance(SEC);
    r.join('p', { key: POD });
    r.advance(SEC);
    r.join('b', { key: DUEL });
    r.advance(SEC);
    r.join('c', { key: POD, address: 'x' });
    expect(NOTICE_KINDS).toContain('queueLost');
    const lost = r.matcher.drain();
    expect(lost.map((e) => e.session)).toEqual(['a', 'p', 'b', 'c']);
    expect(lost.map((e) => e.key)).toEqual([STANDARD, POD, DUEL, POD]);
    expect(lost[0]).toEqual(r.made.get('a'));
    // nobody is queued any more
    for (const s of ['a', 'p', 'b', 'c']) expect(r.matcher.queued(s)).toBeNull();
    expect(r.matcher.status(STANDARD, r.now).waiting).toBe(0);
    expect(r.matcher.status(POD, r.now).waiting).toBe(0);
    expect(r.matcher.drain()).toEqual([]);
  });

  it('after a drain nothing is matched and nobody can queue (the gateway answers `draining` itself)', () => {
    const r = new Rig();
    r.joinAll(['a', 'b', 'c', 'd']);
    r.matcher.drain();
    expect(r.tick()).toEqual([]);
    expect(r.join('e')).toBe('notOffered');
    expect(r.matcher.queued('e')).toBeNull();
    // a failed ready check that settles during the drain puts nobody back
    const e1 = r.entry('x');
    r.matcher.requeueFront([e1], r.now);
    expect(r.matcher.queued('x')).toBeNull();
    expect(r.matcher.leave('a')).toBe(false);
  });

  it('a restarted server has empty queues: the sessions that were queued queue again and are matched', () => {
    const before = new Rig();
    before.joinAll(['a', 'b', 'c']);
    const queuedBefore = before.matcher.drain().map((e) => e.session);
    expect(queuedBefore).toEqual(['a', 'b', 'c']);

    // the process restarts: a new matcher, nothing in it
    const after = new Rig();
    for (const s of queuedBefore) expect(after.matcher.queued(s)).toBeNull();
    expect(after.matcher.status(STANDARD, after.now)).toEqual({ waiting: 0, estimatedWaitMs: null });
    expect(after.tick()).toEqual([]);
    // one click each: their decks are checked again and they enter (new entries, a new waiting time)
    after.advance(30 * SEC);
    after.joinAll(queuedBefore);
    expect(pairs(after.tick())).toEqual(['a+b']);
    expect(after.matcher.queued('c')).toEqual(STANDARD);
  });

  it('what the drain hands back is the matcher\'s copy as entered, not a live reference into the queue', () => {
    const r = new Rig();
    r.join('a');
    const [lost] = r.matcher.drain() as [MatchEntry];
    expect(lost).toEqual(r.made.get('a'));
    expect(Object.isFrozen(lost)).toBe(true);
    // a new matcher built from the same context accepts the same entry again
    const fresh = new FifoMatcher({ sessionBusy: () => false, offered: () => true, policy: DEFAULT_MATCH_POLICY });
    expect(fresh.enter(lost, r.now)).toBeNull();
  });
});

/**
 * No immediate rematch (design 4.5): two sessions that just played each other are not matched again unless one has waited more than 60 s and nobody
 * else fits. In 1v1 and in pods (every pair of a pod counts).
 */
import { describe, expect, it } from 'vitest';
import { pairs, POD, Rig, SEC, who } from './helpers';

describe('M13-9: no immediate rematch (1v1)', () => {
  it('two sessions that just played alone in the queue: matched only after one has waited MORE than 60 s', () => {
    const r = new Rig();
    r.join('a', { recent: ['b'] });
    r.join('b', { recent: ['a'] });
    expect(r.tick()).toEqual([]);
    expect(r.advance(30 * SEC).tick()).toEqual([]);
    expect(r.advance(30 * SEC).tick()).toEqual([]); // exactly 60 s: not more than 60 s
    expect(pairs(r.advance(1).tick())).toEqual(['a+b']); // 60 s and a millisecond
  });

  it('either one\'s list is enough to make a recent pair', () => {
    const r = new Rig();
    r.join('a', { recent: ['b'] });
    r.join('b'); // b does not list a (its last game was against a, but the gateway recorded only a's side)
    expect(r.tick()).toEqual([]);
    const s = new Rig();
    s.join('a');
    s.join('b', { recent: ['a'] });
    expect(s.tick()).toEqual([]);
  });

  it('somebody else is preferred to a rematch, however long the pair has waited', () => {
    const r = new Rig();
    r.join('a', { recent: ['b'] });
    r.advance(SEC);
    r.join('b', { recent: ['a'] });
    r.advance(70 * SEC); // a has waited 71 s, b 70 s: a rematch would be allowed...
    r.join('c'); // ...but c fits a
    expect(pairs(r.tick())).toEqual(['a+c']);
    expect(r.matcher.queued('b')).not.toBeNull(); // b waits for the next one
    r.join('d');
    expect(pairs(r.tick())).toEqual(['b+d']);
  });

  it('before the 60 s, a recent pair waits for others: each takes the next one who did not just play it', () => {
    const r = new Rig();
    r.join('a', { recent: ['b'] });
    r.advance(SEC);
    r.join('b', { recent: ['a'] });
    r.advance(SEC);
    r.join('c');
    r.advance(SEC);
    r.join('d');
    expect(pairs(r.tick())).toEqual(['a+c', 'b+d']);
  });

  it('four who just played in two pairs are matched across the pairs', () => {
    const r = new Rig();
    r.join('a', { recent: ['b'] });
    r.join('b', { recent: ['a'] });
    r.join('c', { recent: ['d'] });
    r.join('d', { recent: ['c'] });
    expect(pairs(r.tick())).toEqual(['a+c', 'b+d']);
  });

  it('past the 60 s the relaxation is for an anchor with nobody else: newcomers who fit are matched first', () => {
    const r = new Rig();
    r.join('a', { recent: ['b'] });
    r.join('b', { recent: ['a'] });
    r.advance(61 * SEC);
    r.join('c');
    r.join('d');
    // a (61 s) is the anchor: c fits it, so a+c; b takes d
    expect(pairs(r.tick())).toEqual(['a+c', 'b+d']);
  });

  it('after the relaxation the rematch is allowed once, and the next game starts the rule again', () => {
    const r = new Rig();
    r.join('a', { recent: ['b'] });
    r.join('b', { recent: ['a'] });
    r.advance(61 * SEC);
    expect(pairs(r.tick())).toEqual(['a+b']);
    // they queue again after that game: their lists name each other again
    r.join('a', { recent: ['b'] });
    r.join('b', { recent: ['a'] });
    expect(r.tick()).toEqual([]);
  });

  it('the rematch wait is the policy\'s', () => {
    const r = new Rig({ policy: { rematchAfterMs: 10 * SEC } });
    r.join('a', { recent: ['b'] });
    r.join('b', { recent: ['a'] });
    expect(r.advance(10 * SEC).tick()).toEqual([]);
    expect(r.advance(1).tick()).toHaveLength(1);
  });

  it('a session that is not in anybody\'s list is matched at once', () => {
    const r = new Rig();
    r.join('a', { recent: ['x', 'y', 'z'] });
    r.join('b', { recent: ['q'] });
    expect(pairs(r.tick())).toEqual(['a+b']);
  });
});

describe('M13-9: no immediate rematch (pods)', () => {
  it('a pod is filled with players who did not just play each other: the pair is left for later', () => {
    const r = new Rig();
    r.join('a', { key: POD, recent: ['b'] });
    r.join('b', { key: POD, recent: ['a'] });
    r.joinAll(['c', 'd', 'e'], { key: POD });
    // a takes c, d, e: b waits (a 4-pod without the recent pair exists)
    expect(pairs(r.tick())).toEqual(['a+c+d+e']);
    expect(r.matcher.queued('b')).toEqual(POD);
  });

  it('four who just played a pod together wait, and are matched again only after one has waited more than 60 s', () => {
    const r = new Rig();
    const all = ['a', 'b', 'c', 'd'];
    for (const s of all) r.join(s, { key: POD, recent: all.filter((x) => x !== s) });
    expect(r.tick()).toEqual([]);
    expect(r.advance(60 * SEC).tick()).toEqual([]);
    const [m] = r.advance(1).tick();
    expect(who(m!)).toEqual(all);
    expect(m!.seats).toBe(4);
  });

  it('a pod search is not fooled by the first choice: it finds the set without a recent pair even when the nearest players conflict', () => {
    const r = new Rig();
    // a may play everyone; b and c, and b and d just played each other. The nearest three (a, b, e) would leave c and d; the set a, c, d, e is allowed.
    r.join('a', { key: POD });
    r.join('b', { key: POD, recent: ['c', 'd'] });
    r.join('c', { key: POD, recent: ['b'] });
    r.join('d', { key: POD, recent: ['b'] });
    r.join('e', { key: POD });
    expect(pairs(r.tick())).toEqual(['a+c+d+e']);
    expect(r.matcher.queued('b')).toEqual(POD);
  });

  it('a pod of 3 without a recent pair comes before a pod of 4 with one (the rematch rule first, then the fill)', () => {
    const r = new Rig();
    r.join('a', { key: POD, recent: ['b'] });
    r.join('b', { key: POD, recent: ['a'] });
    r.join('c', { key: POD });
    r.join('d', { key: POD });
    // a has waited 95 s: it may start with 3, and a, b, c, d under the relaxation would be a pod of 4 with a rematch
    const [m] = r.advance(95 * SEC).tick();
    expect(who(m!)).toEqual(['a', 'c', 'd']);
    expect(r.matcher.queued('b')).toEqual(POD);
  });
});

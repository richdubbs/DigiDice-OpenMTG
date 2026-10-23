/** Pods (design 4.5, 13.4): pods fill to 4 and start with 3 after 90 s of waiting; a 2-player match from a pod queue never happens. */
import { describe, expect, it } from 'vitest';
import { DEFAULT_MATCH_POLICY } from '../../src/match';
import { DUEL, pairs, POD, Rig, SEC, who } from './helpers';

describe('M13-9: pods fill to 4', () => {
  it('three waiting do not start; the fourth fills the pod at once', () => {
    const r = new Rig();
    r.joinAll(['a', 'b', 'c'], { key: POD }, SEC);
    expect(r.tick()).toEqual([]);
    r.advance(SEC);
    r.join('d', { key: POD });
    const [m] = r.tick();
    expect(who(m!)).toEqual(['a', 'b', 'c', 'd']);
    expect(m).toMatchObject({ key: POD, seats: 4, formedAt: r.now });
    expect(r.matcher.status(POD, r.now).waiting).toBe(0);
  });

  it('five waiting make one pod of the first four; the fifth waits', () => {
    const r = new Rig();
    r.joinAll(['a', 'b', 'c', 'd', 'e'], { key: POD }, SEC);
    expect(pairs(r.tick())).toEqual(['a+b+c+d']);
    expect(r.matcher.queued('e')).toEqual(POD);
  });

  it('eight waiting make two pods in one tick, the older first', () => {
    const r = new Rig();
    r.joinAll(['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'], { key: POD }, SEC);
    expect(pairs(r.tick())).toEqual(['a+b+c+d', 'e+f+g+h']);
  });

  it('a pod of 4 is preferred to a pod of 3, however long the oldest has waited', () => {
    const r = new Rig();
    r.joinAll(['a', 'b', 'c'], { key: POD }, SEC);
    r.advance(100 * SEC);
    r.join('d', { key: POD });
    expect(pairs(r.tick())).toEqual(['a+b+c+d']);
  });

  it('a 1v1 queue of the same format is its own queue: nobody from it fills a pod', () => {
    const r = new Rig();
    r.joinAll(['a', 'b', 'c'], { key: POD });
    r.join('d', { key: DUEL });
    r.join('e', { key: DUEL });
    expect(pairs(r.tick())).toEqual(['d+e']);
    expect(r.matcher.status(POD, r.now).waiting).toBe(3);
  });
});

describe('M13-9: a pod starts with 3 after 90 s', () => {
  it('not at 89.999 s, at 90 s: the pod of 3, with the oldest\'s wait counting', () => {
    const r = new Rig();
    r.join('a', { key: POD });
    r.advance(10 * SEC);
    r.join('b', { key: POD });
    r.advance(10 * SEC);
    r.join('c', { key: POD });
    expect(r.advance(70 * SEC - 1).tick()).toEqual([]); // a: 89.999 s
    const [m] = r.advance(1).tick(); // a: 90 s, c only 70 s
    expect(who(m!)).toEqual(['a', 'b', 'c']);
    expect(m).toMatchObject({ key: POD, seats: 3 });
  });

  it('two players never make a match from a pod queue, however long they wait', () => {
    const r = new Rig();
    r.joinAll(['a', 'b'], { key: POD });
    for (const wait of [90 * SEC, 5 * 60 * SEC, 60 * 60 * SEC]) expect(r.advance(wait).tick()).toEqual([]);
    expect(r.matcher.status(POD, r.now).waiting).toBe(2);
    // one more at that late time: three who have waited, the oldest past 90 s: a pod of 3
    r.join('c', { key: POD });
    expect(who(r.tick()[0]!)).toEqual(['a', 'b', 'c']);
  });

  it('seven waiting: a pod of 4 at once, then the other three start when their oldest has waited 90 s', () => {
    const r = new Rig();
    r.joinAll(['a', 'b', 'c', 'd'], { key: POD });
    r.advance(10 * SEC);
    r.joinAll(['e', 'f', 'g'], { key: POD });
    expect(pairs(r.tick())).toEqual(['a+b+c+d']);
    expect(r.advance(90 * SEC - 1).tick()).toEqual([]);
    const [m] = r.advance(1).tick();
    expect(who(m!)).toEqual(['e', 'f', 'g']);
    expect(m!.seats).toBe(3);
  });

  it('the 4th who arrives while the three wait fills the pod, even at 80 s', () => {
    const r = new Rig();
    r.joinAll(['a', 'b', 'c'], { key: POD });
    r.advance(80 * SEC);
    expect(r.tick()).toEqual([]);
    r.join('d', { key: POD });
    expect(who(r.tick()[0]!)).toEqual(['a', 'b', 'c', 'd']);
  });

  it('the pod wait is the policy\'s (POD_THREE_AFTER_SECONDS)', () => {
    const r = new Rig({ policy: { podThreeAfterMs: 30 * SEC } });
    r.joinAll(['a', 'b', 'c'], { key: POD });
    expect(r.advance(30 * SEC - 1).tick()).toEqual([]);
    expect(r.advance(1).tick()).toHaveLength(1);
    expect(DEFAULT_MATCH_POLICY.podThreeAfterMs).toBe(90 * SEC);
  });

  it('the oldest entry\'s wait is the pod\'s wait: newcomers start with it, and alone they are not due', () => {
    const r = new Rig();
    // x waits alone for 200 s (a pod needs three), then two arrive: the three start at once because x, the oldest, has waited past 90 s
    r.join('x', { key: POD });
    r.advance(200 * SEC);
    r.joinAll(['y', 'z'], { key: POD });
    expect(who(r.tick()[0]!)).toEqual(['x', 'y', 'z']);
    // but a group of newcomers alone is not due
    const s = new Rig();
    s.joinAll(['y', 'z', 'w'], { key: POD });
    expect(s.tick()).toEqual([]);
  });
});

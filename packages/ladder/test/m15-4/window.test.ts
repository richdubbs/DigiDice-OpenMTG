/**
 * M15-4: the window rule (design 9.2, 9.3, 17.7): rankedWindow at 0, 15, 30, 90 s and 5 minutes, in 1v1 and pods, with the default policy and
 * another; and the queued entry's own window from the matcher (`window(account, now)`).
 */
import { describe, expect, it } from 'vitest';
import { DEFAULT_RANKED_POLICY } from '../../src/match/api';
import { rankedWindow } from '../../src/match/index';
import { acc, harness, MIN, POD, SEC } from './helpers';

describe('M15-4: rankedWindow (9.2, 9.3)', () => {
  it('1v1: ±100 at 0 s, +50 every 15 s, at most ±400 (from 90 s), everyone at 5 minutes', () => {
    const at = (ms: number) => rankedWindow(ms, false);
    expect([0, 15 * SEC, 30 * SEC, 90 * SEC, 5 * MIN].map(at)).toEqual([100, 150, 200, 400, 'everyone']);
    expect([14_999, 29_999, 45 * SEC, 60 * SEC, 75 * SEC, 89_999].map(at)).toEqual([100, 150, 250, 300, 350, 350]);
    expect([120 * SEC, 4 * MIN, 5 * MIN - 1].map(at)).toEqual([400, 400, 400]);
    expect([5 * MIN + 1, 60 * MIN, Infinity].map(at)).toEqual(['everyone', 'everyone', 'everyone']);
  });

  it('pods: the same steps up to ±500 (from 120 s), everyone at 5 minutes', () => {
    const at = (ms: number) => rankedWindow(ms, true);
    expect([0, 15 * SEC, 30 * SEC, 90 * SEC, 5 * MIN].map(at)).toEqual([100, 150, 200, 400, 'everyone']);
    expect([105 * SEC, 120 * SEC, 4 * MIN, 5 * MIN - 1].map(at)).toEqual([450, 500, 500, 500]);
  });

  it('the default policy is DEFAULT_RANKED_POLICY; another policy changes every step', () => {
    expect(rankedWindow(30 * SEC, false, DEFAULT_RANKED_POLICY)).toBe(rankedWindow(30 * SEC, false));
    const p = { ...DEFAULT_RANKED_POLICY, windowStart: 50, windowStep: 25, windowEveryMs: 10 * SEC, windowCap1v1: 125, everyoneAfterMs: 60 * SEC };
    expect([0, 10 * SEC, 20 * SEC, 30 * SEC, 59_999, 60 * SEC].map((ms) => rankedWindow(ms, false, p))).toEqual([50, 75, 100, 125, 125, 'everyone']);
  });

  it('a negative wait counts as 0; a NaN wait or a bad policy is a RangeError', () => {
    expect(rankedWindow(-5 * SEC, false)).toBe(100);
    expect(rankedWindow(-Infinity, true)).toBe(100);
    expect(() => rankedWindow(Number.NaN, false)).toThrow(RangeError);
    expect(() => rankedWindow(0, false, { ...DEFAULT_RANKED_POLICY, windowEveryMs: 0 })).toThrow(/windowEveryMs/);
    expect(() => rankedWindow(0, false, { ...DEFAULT_RANKED_POLICY, windowStep: Number.NaN })).toThrow(/windowStep/);
    expect(() => rankedWindow(0, false, { ...DEFAULT_RANKED_POLICY, podCandidates: 2.5 })).toThrow(/podCandidates/);
  });
});

describe('M15-4: the entry\'s own window (9.5, RankedMatcher.window)', () => {
  it('follows the entry\'s wait at 0, 15, 30, 90 s and 5 minutes, by the 1v1 or pod cap; null when not queued', () => {
    const h = harness();
    const t0 = h.clock.now();
    h.join(1, 1500);
    h.join(2, 1500, { ...POD, enteredAt: t0 });
    const at = (ms: number) => [h.m.window(acc(1), t0 + ms), h.m.window(acc(2), t0 + ms)];
    expect([0, 15 * SEC, 30 * SEC, 90 * SEC, 120 * SEC, 5 * MIN].map(at)).toEqual([
      [100, 100], [150, 150], [200, 200], [400, 400], [400, 500], ['everyone', 'everyone'],
    ]);
    expect(h.m.window(acc(3), t0)).toBeNull();
  });

  it('a requeued entry keeps its wait, so its window stays wide (9.5)', () => {
    const h = harness();
    const a = h.join(1, 1500);
    h.join(2, 1550);
    h.clock.advance(45 * SEC);
    const [m] = h.tick();
    expect(m!.entries.map((e) => e.account)).toEqual([a.account, acc(2)]);
    expect(h.m.window(a.account, h.clock.now())).toBeNull();
    h.clock.advance(15 * SEC);
    h.m.requeueFront([m!.entries[0]!], h.clock.now());
    expect(h.m.window(a.account, h.clock.now())).toBe(300);
  });
});

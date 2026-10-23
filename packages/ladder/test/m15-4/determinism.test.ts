/**
 * M15-4: determinism and the rule as written (design 9.6, 17.7), with the fake clock and a counter for newMatchId.
 *
 *  - On fixed generated queues (1v1 and pods: ties in rating and enteredAt, placement players, shared address keys, recent games, block notes),
 *    every tick equals the plain search of test/m15-4/reference.ts, which tries every free entry for every anchor with no early stop.
 *  - The same entries, entered and noted in another order, give deeply equal matches with the same ids, in the same order.
 *  - Match ids: one newMatchId() per match, in the order returned; a throwing id source leaves every entry queued.
 *  - requeueFront keeps enteredAt, so the requeued keep their place and their windows.
 *  - Ladders come out in LADDER_IDS order.
 */
import { describe, expect, it } from 'vitest';
import type { AccountId } from '../../src/accounts';
import { LADDER_IDS, type LadderId } from '../../src/api';
import { DEFAULT_RANKED_POLICY, type RankedEntry, type RankedMatch } from '../../src/match/api';
import { createRatedMatcher } from '../../src/match/index';
import { FakeClock } from '../support/clock';
import { counterIds, fixedRandom } from '../support/random';
import { acc, entry, harness, MIN, num, POD, SEC, who } from './helpers';
import { referenceTick } from './reference';

/** Whole numbers below n from a fixed seed (no chance: fixed inputs only). */
function draws(seed: string): (n: number) => number {
  const bytes = fixedRandom(seed);
  return (n) => {
    const b = bytes(4);
    return (((b[0]! << 24) | (b[1]! << 16) | (b[2]! << 8) | b[3]!) >>> 0) % n;
  };
}

interface Scenario {
  entries: RankedEntry[];
  blocks: [AccountId, AccountId][];
}

/**
 * A queue of `n` entries for `ladder` entering before `t0`, with ties, placement, shared keys, recent games and blocks; ratings on a 10-point grid
 * of `levels` steps from `low`, so a small grid packs many entries at equal distances (the 12-candidate boundary).
 */
function scenario(seed: string, ladder: LadderId, n: number, t0: number, low = 1100, levels = 80): Scenario {
  const d = draws(seed);
  const pod = ladder === 'pod-commander';
  const ids = Array.from({ length: n }, (_, i) => i + 1);
  const entries = ids.map((i) => {
    const recent: number[][] = [];
    for (let g = d(5); g > 0; g--) {
      const size = pod ? 2 + d(2) : 1;
      recent.push(Array.from({ length: size }, () => 1 + d(n + 4)).filter((o) => o !== i));
    }
    return entry(i, low + 10 * d(levels), t0 - 5_000 * d(180), {
      ladder,
      placement: d(10) < 3,
      addressKey: `ip${d(Math.max(2, Math.floor(n * 0.8)))}`,
      recent,
    });
  });
  const blocks: [AccountId, AccountId][] = [];
  for (let k = d(Math.ceil(n / 2) + 1); k > 0; k--) blocks.push([acc(1 + d(n)), acc(1 + d(n))]);
  return { entries, blocks };
}

const keyOf = (a: AccountId, b: AccountId) => (a < b ? `${a} ${b}` : `${b} ${a}`);

describe('M15-4: the matcher equals the rule as written (9.2-9.4)', () => {
  it('on fixed generated queues, tick after tick, in 1v1 and pods', () => {
    let matches = 0;
    let relaxed = 0;
    for (let s = 0; s < 80; s++) {
      // 0-59: 1v1 and pods by turns, 4 to 30 entries over 800 points; 60-79: dense pods, 20 to 39 entries over 120 points
      const dense = s >= 60;
      const ladder: LadderId = dense || s % 2 === 1 ? 'pod-commander' : '1v1-standard';
      const clock = new FakeClock();
      const t0 = clock.now();
      const { entries, blocks } = dense
        ? scenario(`m15-4 reference ${s}`, ladder, 20 + (s % 20), t0, 1440, 12)
        : scenario(`m15-4 reference ${s}`, ladder, 4 + (s % 27), t0);
      const m = createRatedMatcher({
        sessionBusy: () => false, accountBusy: () => false, cooldown: () => false, offered: () => true, newMatchId: counterIds(),
        policy: DEFAULT_RANKED_POLICY,
      });
      const byAccount = new Map<AccountId, RankedEntry>();
      for (const e of entries) if (m.enter(e, t0) === null) byAccount.set(e.account, e);
      m.noteBlocks(blocks);
      const noted = new Set(blocks.filter(([a, b]) => a !== b).map(([a, b]) => keyOf(a, b)));
      const blocked = (a: AccountId, b: AccountId) => noted.has(keyOf(a, b));
      for (const step of [0, 15 * SEC, 45 * SEC, 2 * MIN, 5 * MIN, 10 * MIN, 20 * MIN]) {
        const now = clock.set(t0 + step);
        const queue = [...byAccount.values()].filter((e) => m.queued(e.account) !== null);
        const want = referenceTick(ladder, queue, now, DEFAULT_RANKED_POLICY, blocked);
        const got = m.tick(now);
        expect(got.map((x) => ({ ladder: x.ladder, accounts: x.entries.map((e) => e.account), spread: x.spread, relaxed: x.relaxed })),
          `scenario ${s} at +${step} ms`).toEqual(want);
        for (const x of got) expect(x.seats).toBe(x.entries.length);
        matches += got.length;
        relaxed += got.filter((x) => x.relaxed).length;
      }
    }
    // the scenarios reach the cases that matter: many matches, some of them relaxed
    expect(matches).toBeGreaterThan(250);
    expect(relaxed).toBeGreaterThan(10);
  });
});

describe('M15-4: the same input gives the same matches (9.6)', () => {
  it('whatever the order of entering and noting, deeply equal matches with the same ids, in the same order', () => {
    const t0 = new FakeClock().now();
    const all: Scenario[] = LADDER_IDS.map((ladder, i) => scenario(`m15-4 same ${i}`, ladder, 24, t0));
    // one account space across the ladders: number the entries 1..96
    const entries = all.flatMap((sc, i) => sc.entries.map((e) => ({
      ...e, account: acc(num(e.account) + 100 * i), session: `s${num(e.account) + 100 * i}`, addressKey: `${e.addressKey}/${i}`,
      recent: e.recent.map((g) => g.map((a) => acc(num(a) + 100 * i))),
    })));
    const blocks = all.flatMap((sc, i) => sc.blocks.map(([a, b]) => [acc(num(a) + 100 * i), acc(num(b) + 100 * i)] as [AccountId, AccountId]));
    const run = (order: 'forward' | 'backward' | 'interleaved'): RankedMatch[][] => {
      // no address limit here: which of three entries with one key is refused would depend on the order of entering
      const m = createRatedMatcher({
        sessionBusy: () => false, accountBusy: () => false, cooldown: () => false, offered: () => true, newMatchId: counterIds(),
        policy: { ...DEFAULT_RANKED_POLICY, perAddress: 100 },
      });
      const es = order === 'forward' ? entries : order === 'backward' ? [...entries].reverse()
        : entries.filter((_, i) => i % 2 === 1).concat(entries.filter((_, i) => i % 2 === 0));
      for (const e of es) expect(m.enter(e, t0)).toBeNull();
      m.noteBlocks(order === 'forward' ? blocks : blocks.map(([a, b]) => [b, a] as [AccountId, AccountId]).reverse());
      return [0, 30 * SEC, 2 * MIN, 5 * MIN, 10 * MIN].map((step) => m.tick(t0 + step));
    };
    const forward = run('forward');
    expect(run('backward')).toEqual(forward);
    expect(run('interleaved')).toEqual(forward);
    const flat = forward.flat();
    expect(flat.length).toBeGreaterThan(10);
    expect(flat.map((x) => x.match)).toEqual(flat.map((_, i) => `m${i + 1}`));
    // ladders in LADDER_IDS order within each tick
    for (const tick of forward) {
      const order = tick.map((x) => LADDER_IDS.indexOf(x.ladder));
      expect(order).toEqual([...order].sort((a, b) => a - b));
    }
    expect(new Set(flat.map((x) => x.ladder)).size).toBe(4);
  });
});

describe('M15-4: match ids (9.6)', () => {
  it('one newMatchId() per match, in the order returned, nothing taken for a tick with no match', () => {
    let calls = 0;
    const h = harness();
    h.ctx.newMatchId = () => `x${++calls}`; // the matcher reads newMatchId from the context it was given
    h.join(1, 1500);
    h.join(2, 1510);
    h.join(3, 1500, { ladder: '1v1-pauper' });
    h.join(4, 1510, { ladder: '1v1-pauper' });
    h.join(5, 1500, { ladder: '1v1-pioneer' });
    h.join(6, 1510, { ladder: '1v1-pioneer' });
    h.join(9, 1900);
    const ms = h.tick();
    expect(ms.map((m) => [m.match, m.ladder])).toEqual([['x1', '1v1-standard'], ['x2', '1v1-pioneer'], ['x3', '1v1-pauper']]);
    expect(h.tick()).toEqual([]);
    expect(calls).toBe(3);
  });

  it('a throwing id source leaves every entry queued', () => {
    const h = harness();
    h.ctx.newMatchId = () => {
      throw new Error('no ids');
    };
    h.join(1, 1500);
    h.join(2, 1510);
    expect(() => h.tick()).toThrow('no ids');
    expect(h.waiting()).toEqual([1, 2]);
    h.ctx.newMatchId = () => 'again';
    expect(h.tick().map((m) => m.match)).toEqual(['again']);
  });
});

describe('M15-4: requeueFront (9.5)', () => {
  it('keeps enteredAt: a confirmer of a failed ready check anchors before a later entry and keeps its wide window', () => {
    const h = harness();
    const t0 = h.clock.now();
    h.join(1, 1500);
    h.join(2, 1600);
    const [m] = h.tick();
    expect(who([m!])).toEqual([[1, 2]]);
    h.clock.set(t0 + 20 * SEC);
    h.join(3, 1700);
    h.clock.set(t0 + 30 * SEC);
    // the ready check: 2 confirmed, 1 missed
    h.m.missed(acc(1), h.clock.now());
    h.m.requeueFront([m!.entries[1]!], h.clock.now());
    expect(h.waiting()).toEqual([2, 3]);
    expect(h.m.window(acc(2), h.clock.now())).toBe(200);
    expect(h.m.window(acc(3), h.clock.now())).toBe(100);
    const [again] = h.tick();
    expect(who([again!])).toEqual([[2, 3]]); // 2 is the anchor: it is the older
    expect(again!.entries[0]!.enteredAt).toBe(t0);
  });

  it('puts back an account that is queued again already only once, and checks no limit', () => {
    const h = harness({ perAddress: 1 });
    const t0 = h.clock.now();
    h.join(1, 1500, { addressKey: 'home' });
    h.join(2, 1510);
    const [m] = h.tick();
    h.join(3, 1500, { addressKey: 'home' }); // the address slot came free when 1 was matched
    h.join(2, 1510, { enteredAt: t0 + MIN }); // 2 queued again by itself
    h.m.requeueFront(m!.entries, h.clock.now());
    expect(h.waiting()).toEqual([1, 3, 2]);
    expect(h.m.queued(acc(2))).toBe('1v1-standard');
    expect(() => h.m.requeueFront([{ ...entry(7, 1500, t0), ladder: 'nope' as never }], t0)).toThrow(TypeError);
    expect(h.m.queued(acc(7))).toBeNull();
  });

  it('a requeued pod keeps its members\' places in the pod queue', () => {
    const h = harness();
    const t0 = h.clock.now();
    for (let n = 1; n <= 4; n++) h.join(n, 1500 + n, { ...POD, enteredAt: t0 - n * SEC });
    const [m] = h.tick();
    h.clock.set(t0 + MIN);
    h.join(5, 1500, POD);
    h.m.requeueFront(m!.entries, h.clock.now());
    expect(h.waiting('pod-commander')).toEqual([4, 3, 2, 1, 5]);
  });
});

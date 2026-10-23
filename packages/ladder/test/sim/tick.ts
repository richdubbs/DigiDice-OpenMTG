/**
 * M15-6: the rated matcher's tick with 2,000 entries (design 9.6, 17.11: "a matcher tick with 2,000 entries under 50 ms on the owner's machine,
 * reported, not asserted in the default suite"). Each run builds a fresh matcher with 2,000 entries of one shape and times one `tick` (the build is
 * not timed). The entries come from a seeded RNG, so every run ticks the same queue; only the wall time varies with the machine.
 *
 * Shapes:
 *  - `queue`: a busy queue as the simulation sees it: shown ratings N(1500, 150), waits uniform over the last 6 minutes (so some are past
 *    'everyone' and the rematch relaxation is near), 10% in placement, each with 3 recent games against random others. Most entries are matched.
 *  - `stuck`: every entry entered in the last 15 s (windows of 100) and the ratings are spaced so that nothing may be matched (1v1 101 points
 *    apart; pods 40, so any 4 have a spread above 100): the whole search runs and forms nothing, the costliest tick for pods (O(n · 220)).
 */
import type { AccountId } from '../../src/accounts';
import { createRatedMatcher } from '../../src/match/index';
import { DEFAULT_RANKED_POLICY, type RankedEntry, type RankedMatchPolicy } from '../../src/match/api';
import { simAccount } from './abuse';
import type { SimLadder } from './params';
import { Rng } from './rng';
import { median } from './stats';

export type TickShape = 'queue' | 'stuck';

const NOW = Date.UTC(2027, 2, 10, 12);

export function tickEntries(ladder: SimLadder, shape: TickShape, n: number, rng: Rng): RankedEntry[] {
  const pod = ladder === 'pod-commander';
  const accounts: AccountId[] = Array.from({ length: n }, (_, i) => simAccount(i + 1));
  const spacing = pod ? 40 : 101;
  return accounts.map((account, i): RankedEntry => {
    const others = (k: number) => Array.from({ length: k }, () => accounts[rng.int(n)]!).filter((a) => a !== account);
    return {
      account, session: `s${i}`, addressKey: `a${i}`, ladder, deck: 'deck',
      enteredAt: shape === 'queue' ? NOW - Math.round(rng.uniform(0, 6 * 60_000)) : NOW - Math.round(rng.uniform(0, 14_000)),
      rating: shape === 'queue' ? Math.round(rng.normal(1500, 150)) : 1500 + (i - n / 2) * spacing,
      deviation: 80, placement: shape === 'queue' && rng.chance(0.1),
      recent: [others(pod ? 3 : 1), others(pod ? 3 : 1), others(pod ? 3 : 1)],
    };
  });
}

export interface TickTiming {
  ladder: SimLadder;
  shape: TickShape;
  entries: number;
  repeats: number;
  /** Matches the tick formed (the same every repeat). */
  matches: number;
  medianMs: number;
  maxMs: number;
}

/** Times `repeats` ticks of a fresh matcher holding `n` entries of `shape`. */
export function timeTick(ladder: SimLadder, shape: TickShape, n = 2000, repeats = 15, seed = 'tick', policy: Readonly<RankedMatchPolicy> = DEFAULT_RANKED_POLICY): TickTiming {
  const entries = tickEntries(ladder, shape, n, new Rng(`${seed}/${ladder}/${shape}`));
  const times: number[] = [];
  let matches = 0;
  for (let k = 0; k < repeats + 1; k++) {
    let ids = 0;
    const m = createRatedMatcher({
      sessionBusy: () => false, accountBusy: () => false, cooldown: () => false, offered: () => true, newMatchId: () => `m${++ids}`, policy,
    });
    for (const e of entries) {
      const refused = m.enter(e, NOW);
      if (refused !== null) throw new Error(`timeTick: ${e.account} refused (${refused})`);
    }
    const t = performance.now();
    const formed = m.tick(NOW);
    const ms = performance.now() - t;
    matches = formed.length;
    if (k > 0) times.push(ms); // the first tick warms the JIT up
  }
  return { ladder, shape, entries: n, repeats, matches, medianMs: median(times), maxMs: Math.max(...times) };
}

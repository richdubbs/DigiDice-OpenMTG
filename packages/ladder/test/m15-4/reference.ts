/**
 * M15-4: the rated matcher's tick written the plain way, straight from design 9.2-9.4, with no early stops: every anchor (oldest first) tries every
 * free entry. The tests compare the matcher's tick with it on fixed generated queues, so the matcher's outward walk and its stops (src/match/one.ts,
 * src/match/pods.ts) are checked against the rule as written, not against themselves.
 */
import type { AccountId } from '../../src/accounts';
import { LADDERS, type LadderId } from '../../src/api';
import type { RankedEntry, RankedMatchPolicy } from '../../src/match/api';

export interface RefMatch {
  ladder: LadderId;
  accounts: AccountId[];
  spread: number;
  relaxed: boolean;
}

const cmp = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
const age = (a: RankedEntry, b: RankedEntry) => a.enteredAt - b.enteredAt || cmp(a.account, b.account);

function combinations<T>(xs: readonly T[], k: number): T[][] {
  if (k === 0) return [[]];
  const out: T[][] = [];
  xs.forEach((x, i) => {
    for (const rest of combinations(xs.slice(i + 1), k - 1)) out.push([x, ...rest]);
  });
  return out;
}

/** Everything a tick needs about one entry at `now`. */
function facts(e: RankedEntry, now: number, pod: boolean, p: RankedMatchPolicy) {
  const wait = Math.max(0, now - e.enteredAt);
  const steps = Math.floor(wait / p.windowEveryMs);
  return {
    everyone: wait >= p.everyoneAfterMs,
    window: Math.min(pod ? p.windowCapPod : p.windowCap1v1, p.windowStart + p.windowStep * steps),
    relaxable: wait >= p.rematchRelaxMs,
    three: wait >= p.podThreeAfterMs,
  };
}

/** The matches of one ladder's queue at `now`, by the plain rule. `blocked` is the block notes. */
export function referenceTick(
  ladder: LadderId, queue: readonly RankedEntry[], now: number, p: RankedMatchPolicy, blocked: (a: AccountId, b: AccountId) => boolean,
): RefMatch[] {
  const sizes = [...LADDERS[ladder].seats].filter((s) => s > 2).sort((a, b) => b - a);
  const pod = sizes.length > 0;
  const f = new Map(queue.map((e) => [e.account, facts(e, now, pod, p)]));
  const F = (e: RankedEntry) => f.get(e.account)!;
  const inRecent = (a: RankedEntry, b: RankedEntry) => a.recent.slice(0, p.rematchGames).some((g) => g.includes(b.account));
  const repeat = (a: RankedEntry, b: RankedEntry) => inRecent(a, b) || inRecent(b, a);
  const base = (a: RankedEntry, b: RankedEntry) => a.addressKey !== b.addressKey && !blocked(a.account, b.account);
  const relaxPair = (a: RankedEntry, b: RankedEntry) => F(a).relaxable || F(b).relaxable;
  const free = new Set(queue.map((e) => e.account));
  const out: RefMatch[] = [];

  for (const a of [...queue].sort(age)) {
    if (!free.has(a.account)) continue;
    const others = queue.filter((b) => b !== a && free.has(b.account));
    let members: RankedEntry[] | null = null;
    let spread = 0;
    let relaxed = false;

    if (!pod) {
      const allowed = (b: RankedEntry) => {
        const d = Math.abs(a.rating - b.rating);
        return base(a, b) && (F(a).everyone || F(b).everyone || d <= Math.min(F(a).window, F(b).window));
      };
      const strict = others.filter((b) => allowed(b) && !repeat(a, b));
      const pool = strict.length > 0 ? strict : others.filter((b) => allowed(b) && repeat(a, b) && relaxPair(a, b));
      const cost = (b: RankedEntry) => Math.abs(a.rating - b.rating) + (a.placement !== b.placement ? p.placementMixCost : 0);
      pool.sort((x, y) => cost(x) - cost(y) || Math.abs(a.rating - x.rating) - Math.abs(a.rating - y.rating) || age(x, y));
      const b = pool[0];
      if (b !== undefined) {
        members = [a, b];
        spread = Math.abs(a.rating - b.rating);
        relaxed = strict.length === 0 || spread > Math.min(F(a).window, F(b).window);
      }
    } else {
      const tries: [boolean, number][] = [];
      for (const relax of [false, true]) for (const [i, s] of sizes.entries()) if (i === 0 || F(a).three) tries.push([relax, s]);
      for (const [relax, size] of tries) {
        const cands = others
          .filter((c) => base(a, c) && (!repeat(a, c) || (relax && relaxPair(a, c))))
          .sort((x, y) => Math.abs(a.rating - x.rating) - Math.abs(a.rating - y.rating) || age(x, y))
          .slice(0, p.podCandidates);
        let best: { set: RankedEntry[]; cost: number; age: number; ids: string[]; spread: number; relaxed: boolean } | null = null;
        for (const set of combinations(cands, size - 1)) {
          const all = [a, ...set];
          const pairs = combinations(all, 2);
          if (pairs.some(([x, y]) => !base(x!, y!))) continue;
          const repeats = pairs.filter(([x, y]) => repeat(x!, y!));
          if (!relax && repeats.length > 0) continue; // the relaxation allows any number of repeated pairs, each with one that may relax
          if (repeats.some(([x, y]) => !relaxPair(x!, y!))) continue;
          const rs = all.map((m) => m.rating);
          const sp = Math.max(...rs) - Math.min(...rs);
          const outside = sp > Math.min(...all.map((m) => F(m).window));
          if (outside && !all.some((m) => F(m).everyone)) continue;
          const c = {
            set,
            cost: sp + p.placementMixCost * set.filter((m) => m.placement !== a.placement).length + p.repeatedPairCost * repeats.length,
            age: all.reduce((s, m) => s + m.enteredAt, 0),
            ids: set.map((m) => m.account as string).sort(cmp),
            spread: sp,
            relaxed: repeats.length > 0 || outside,
          };
          const better = best === null || c.cost < best.cost || (c.cost === best.cost && (c.age < best.age
            || (c.age === best.age && c.ids.join(',') < best.ids.join(','))));
          if (better) best = c;
        }
        if (best !== null) {
          members = [a, ...[...best.set].sort((x, y) => x.rating - y.rating || age(x, y))];
          spread = best.spread;
          relaxed = best.relaxed;
          break;
        }
      }
    }
    if (members === null) continue;
    for (const m of members) free.delete(m.account);
    out.push({ ladder, accounts: members.map((m) => m.account), spread, relaxed });
  }
  return out;
}

/**
 * M15-4: the pod of one anchor (design 9.3, 9.4). Pure.
 *
 *  - Candidates: the anchor's `podCandidates` (12) nearest entries by rating that may sit with it (address keys differ, no block noted, the rematch
 *    rule); ties in distance by older enteredAt, then account id.
 *  - Sets: every set of `size − 1` candidates (at most 220 for 3 of 12). A set is allowed when all its members' address keys differ, no block is
 *    noted inside it, no two of its members were in a pod in either one's last `rematchGames` games, and its spread (highest minus lowest rating) is
 *    at most every member's window, unless a member has waited everyoneAfterMs (it waives the window rule for the pod).
 *  - Cost: the spread, plus placementMixCost for each member whose placement status differs from the anchor's, plus repeatedPairCost for each repeated
 *    pair the relaxation allows. Ties: the older entries (the smaller sum of enteredAt), then the other members' account ids, sorted, in order.
 *  - Order of tries: 4 players; 3 players once the anchor has waited podThreeAfterMs; then, only if neither is allowed (nothing else is allowed for
 *    the anchor), the relaxation at 4 and then at 3 players: repeated pairs are allowed, each of them only when one of its two has waited
 *    rematchRelaxMs, at repeatedPairCost each, so the cost weighs fewer repeats against a wider spread. Never 2 players.
 *    Any number of repeated pairs, not one (9.4's "a pod with one repeated pair"): with one, a small group whose every pair played together lately
 *    (the 3 or 4 who just played a pod) could never meet again, since their recent games age out only by playing; 9.3 charges the cost "for each
 *    repeated pair allowed by the relaxation" and D14 relaxes the rule outright. Every set the relaxation allows has at least one repeated pair (a
 *    set with none was already tried: its candidates without a repeat with the anchor are the strict try's nearest ones).
 */
import type { AccountId } from '../accounts';
import type { RankedMatchPolicy } from './api';
import { byAge, byRating, compareIds, type Live, type PairBase, relaxablePair, repeated, walkOutward } from './rules';

export interface PodPick {
  /** The anchor first, then by rating (then oldest first). */
  members: Live[];
  spread: number;
  /** Formed under the rematch relaxation, or allowed only because a member waived the window rule. */
  relaxed: boolean;
}

/** The anchor's nearest candidates (9.3); with `relax`, a repeated pair with the anchor counts when either of the two may relax. */
function candidates(
  anchor: Live, sorted: readonly Live[], pos: number, taken: ReadonlySet<AccountId>, base: PairBase, want: number, relax: boolean,
): Live[] {
  if (want === 0) return [];
  const found: { c: Live; d: number }[] = [];
  let bound = Infinity;
  walkOutward(sorted, pos, taken, (c, d) => {
    if (d > bound) return false;
    if (!base(anchor, c)) return true;
    if (repeated(anchor, c) && !(relax && relaxablePair(anchor, c))) return true;
    found.push({ c, d });
    // the walk's distances never decrease: past the want-th one, only ties at its distance can still come in (the age rule may prefer them)
    if (found.length === want) bound = d;
    return true;
  });
  found.sort((x, y) => x.d - y.d || byAge(x.c, y.c));
  return found.slice(0, want).map((f) => f.c);
}

interface SetPick {
  chosen: Live[];
  spread: number;
  cost: number;
  age: number;
  ids: AccountId[];
  relaxed: boolean;
}

function better(c: SetPick, best: SetPick | null): boolean {
  if (best === null) return true;
  if (c.cost !== best.cost) return c.cost < best.cost;
  if (c.age !== best.age) return c.age < best.age;
  for (let i = 0; i < c.ids.length; i++) {
    const o = compareIds(c.ids[i]!, best.ids[i]!);
    if (o !== 0) return o < 0;
  }
  return false;
}

/** The best allowed set of `k` candidates with the anchor; `relax` allows repeated pairs, each with one of its two that may relax. */
function bestSet(anchor: Live, cands: readonly Live[], k: number, relax: boolean, base: PairBase, p: Readonly<RankedMatchPolicy>): SetPick | null {
  const n = cands.length;
  if (k < 1 || n < k) return null;
  // pair facts among the candidates, once: 0 not allowed, 1 allowed, 2 a repeated pair the relaxation may allow
  const pair: number[][] = cands.map((a, i) => cands.map((b, j) => {
    if (i === j || !base(a, b)) return 0;
    if (!repeated(a, b)) return 1;
    return relax && relaxablePair(a, b) ? 2 : 0;
  }));
  // with the anchor: the candidates passed base and the rematch rule (or its relaxation) already
  const withAnchor = cands.map((c) => (repeated(anchor, c) ? 2 : 1));
  const maxRepeats = relax ? Number.POSITIVE_INFINITY : 0;
  let best: SetPick | null = null;
  const idx: number[] = [];

  const consider = (repeats: number): void => {
    const chosen = idx.map((i) => cands[i]!);
    let lo = anchor.rating;
    let hi = anchor.rating;
    let minWindow = anchor.window;
    let everyone = anchor.everyone;
    let mixed = 0;
    let age = anchor.enteredAt;
    for (const m of chosen) {
      if (m.rating < lo) lo = m.rating;
      if (m.rating > hi) hi = m.rating;
      if (m.window < minWindow) minWindow = m.window;
      if (m.everyone) everyone = true;
      if (m.placement !== anchor.placement) mixed++;
      age += m.enteredAt;
    }
    const spread = hi - lo;
    const outside = spread > minWindow;
    if (outside && !everyone) return;
    const c: SetPick = {
      chosen,
      spread,
      cost: spread + p.placementMixCost * mixed + p.repeatedPairCost * repeats,
      age,
      ids: chosen.map((m) => m.account).sort(compareIds),
      relaxed: repeats > 0 || outside,
    };
    if (better(c, best)) best = c;
  };

  const extend = (from: number, repeats: number): void => {
    if (idx.length === k) {
      consider(repeats);
      return;
    }
    for (let i = from; i <= n - (k - idx.length); i++) {
      let r = repeats + (withAnchor[i] === 2 ? 1 : 0);
      let ok = r <= maxRepeats;
      for (let t = 0; ok && t < idx.length; t++) {
        const f = pair[idx[t]!]![i]!;
        if (f === 0) ok = false;
        else if (f === 2) ok = ++r <= maxRepeats;
      }
      if (!ok) continue;
      idx.push(i);
      extend(i + 1, r);
      idx.pop();
    }
  };
  extend(0, 0);
  return best;
}

/** The pod of `anchor` (at `pos` in `sorted`, byRating) among the entries not in `taken`, or null. `sizes`: the pod sizes, largest first (4, 3). */
export function pickPod(
  anchor: Live,
  sorted: readonly Live[],
  pos: number,
  taken: ReadonlySet<AccountId>,
  base: PairBase,
  p: Readonly<RankedMatchPolicy>,
  sizes: readonly number[],
  anyRelaxable: boolean,
): PodPick | null {
  const allowedSizes = sizes.filter((s, i) => s >= 3 && (i === 0 || anchor.three));
  const tries: boolean[] = anyRelaxable ? [false, true] : [false];
  for (const relax of tries) {
    const cands = candidates(anchor, sorted, pos, taken, base, p.podCandidates, relax);
    for (const size of allowedSizes) {
      const pick = bestSet(anchor, cands, size - 1, relax, base, p);
      if (pick !== null) {
        return { members: [anchor, ...[...pick.chosen].sort(byRating)], spread: pick.spread, relaxed: pick.relaxed };
      }
    }
  }
  return null;
}

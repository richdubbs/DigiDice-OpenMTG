/**
 * M15-4: the 1v1 partner of one anchor (design 9.2, 9.4). Pure.
 *
 * A and B may be paired when either has waited everyoneAfterMs, or |rating_A − rating_B| ≤ min(window_A, window_B); and their address keys differ,
 * no block is noted between them, and neither is in the other's last `rematchGames` games. Among the allowed B the one of lowest
 *   cost = |rating_A − rating_B| + (placementMixCost if exactly one of them is in placement)
 * wins; ties: smaller rating distance, then older enteredAt, then account id. Only when no B is allowed, a B that fails only the rematch rule is
 * allowed once either of the two has waited rematchRelaxMs (the relaxation), chosen the same way.
 *
 * The search walks outward from A by rating distance and stops early, which gives the same partner as trying every B:
 *  - Once a partner of cost c is found, a B further than c costs more than c (cost ≥ distance).
 *  - A B further than A's own window can be allowed only through B's everyone rule while A has none. Then B has waited longer than A, so B was an
 *    anchor earlier in this tick and found nobody, while A was still free; every rule (and the relaxation's "either has waited") is symmetric, so
 *    (B, A) was not allowed then, and (A, B) is not now. So the walk stops at A's window unless A has the everyone rule itself.
 * test/m15-4/reference.ts checks this against the plain search on fixed generated queues.
 */
import type { AccountId } from '../accounts';
import type { RankedMatchPolicy } from './api';
import { byAge, type Live, type PairBase, relaxablePair, repeated, walkOutward } from './rules';

export interface PartnerPick {
  partner: Live;
  distance: number;
  /** Allowed only by the everyone rule (the distance is outside the two capped windows) or by the rematch relaxation. */
  relaxed: boolean;
}

interface Candidate extends PartnerPick {
  cost: number;
}

function better(c: Candidate, best: Candidate | null): boolean {
  if (best === null) return true;
  if (c.cost !== best.cost) return c.cost < best.cost;
  if (c.distance !== best.distance) return c.distance < best.distance;
  return byAge(c.partner, best.partner) < 0;
}

/** The partner of `anchor` (at `pos` in `sorted`, byRating) among the entries not in `taken`, or null. */
export function pickPartner(
  anchor: Live,
  sorted: readonly Live[],
  pos: number,
  taken: ReadonlySet<AccountId>,
  base: PairBase,
  p: Readonly<RankedMatchPolicy>,
): PartnerPick | null {
  const limit = anchor.everyone ? Infinity : anchor.window;
  const best: { strict: Candidate | null; relaxed: Candidate | null } = { strict: null, relaxed: null };
  walkOutward(sorted, pos, taken, (b, d) => {
    if (d > limit) return false;
    if (best.strict !== null && d > best.strict.cost) return false;
    if (!base(anchor, b)) return true;
    const outside = d > Math.min(anchor.window, b.window);
    if (outside && !anchor.everyone && !b.everyone) return true;
    const cost = d + (anchor.placement !== b.placement ? p.placementMixCost : 0);
    if (!repeated(anchor, b)) {
      const c: Candidate = { partner: b, distance: d, cost, relaxed: outside };
      if (better(c, best.strict)) best.strict = c;
    } else if (best.strict === null && relaxablePair(anchor, b)) {
      const c: Candidate = { partner: b, distance: d, cost, relaxed: true };
      if (better(c, best.relaxed)) best.relaxed = c;
    }
    return true;
  });
  const pick = best.strict ?? best.relaxed;
  return pick === null ? null : { partner: pick.partner, distance: pick.distance, relaxed: pick.relaxed };
}

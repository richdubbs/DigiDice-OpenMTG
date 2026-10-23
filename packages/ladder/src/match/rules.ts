/**
 * M15-4: the rated matcher's per-tick view of an entry and its pair rules (design 9.2-9.4), shared by the 1v1 search (./one.ts) and the pod search
 * (./pods.ts). Pure: a tick builds a `Live` per waiting entry from `now`, and the searches read only these and the block notes.
 *
 * Every order here is total and uses no locale (`<` on account ids), so a tick is deterministic (9.6).
 */
import type { AccountId } from '../accounts';
import type { RankedEntry, RankedMatchPolicy } from './api';
import { cappedWindow } from './window';

/** An entry as the queue keeps it: the matcher's own copy, and the opponents of its last `rematchGames` games as a set. */
export interface Slot {
  entry: RankedEntry;
  recent: ReadonlySet<AccountId>;
}

/** An entry at one tick's `now`. */
export interface Live {
  slot: Slot;
  account: AccountId;
  rating: number;
  enteredAt: number;
  placement: boolean;
  /** now − enteredAt, at least 0. */
  wait: number;
  /** Waited everyoneAfterMs: may be paired with anyone, and waives the window rule for the other side or the pod (9.2, 9.3). */
  everyone: boolean;
  /** The window without the everyone rule (cappedWindow). */
  window: number;
  /** Waited rematchRelaxMs: a pair it is in may repeat when nothing else is allowed for the anchor (9.4). */
  relaxable: boolean;
  /** Waited podThreeAfterMs: as a pod's anchor, it may form a 3-player pod when no 4-player pod is allowed (9.3). */
  three: boolean;
}

export function live(slot: Slot, now: number, pod: boolean, p: Readonly<RankedMatchPolicy>): Live {
  const e = slot.entry;
  const wait = Math.max(0, now - e.enteredAt);
  return {
    slot,
    account: e.account,
    rating: e.rating,
    enteredAt: e.enteredAt,
    placement: e.placement,
    wait,
    everyone: wait >= p.everyoneAfterMs,
    window: cappedWindow(wait, pod, p),
    relaxable: wait >= p.rematchRelaxMs,
    three: wait >= p.podThreeAfterMs,
  };
}

export function compareIds(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/** Oldest first: enteredAt, then account id (the anchors' order, 9.2). */
export function byAge(a: { enteredAt: number; account: AccountId }, b: { enteredAt: number; account: AccountId }): number {
  return a.enteredAt - b.enteredAt || compareIds(a.account, b.account);
}

/** By rating, then oldest first (the order the searches walk outward in). */
export function byRating(a: Live, b: Live): number {
  return a.rating - b.rating || byAge(a, b);
}

/** The rules of a pair that nothing relaxes (9.4): different address keys, and no block noted between them. */
export type PairBase = (a: Live, b: Live) => boolean;

/** In either one's last `rematchGames` games (1v1: as the opponent; pods: in the same pod). */
export function repeated(a: Live, b: Live): boolean {
  return a.slot.recent.has(b.account) || b.slot.recent.has(a.account);
}

/** A repeated pair may be allowed under the relaxation once either of the two has waited rematchRelaxMs (9.4). */
export function relaxablePair(a: Live, b: Live): boolean {
  return a.relaxable || b.relaxable;
}

/**
 * The rating search both kinds share: walks outward from `pos` in `sorted` (byRating) in order of rating distance from it, skipping `pos` itself and
 * the accounts in `taken`, and calls `visit(other, distance)` until it returns false or the entries run out. Distances never decrease.
 */
export function walkOutward(sorted: readonly Live[], pos: number, taken: ReadonlySet<AccountId>, visit: (other: Live, d: number) => boolean): void {
  const r = sorted[pos]!.rating;
  let lo = pos - 1;
  let hi = pos + 1;
  for (;;) {
    while (lo >= 0 && taken.has(sorted[lo]!.account)) lo--;
    while (hi < sorted.length && taken.has(sorted[hi]!.account)) hi++;
    const hasLo = lo >= 0;
    const hasHi = hi < sorted.length;
    if (!hasLo && !hasHi) return;
    const dLo = hasLo ? Math.abs(r - sorted[lo]!.rating) : 0;
    const dHi = hasHi ? Math.abs(sorted[hi]!.rating - r) : 0;
    const takeLo = hasLo && (!hasHi || dLo <= dHi);
    const other = takeLo ? sorted[lo--]! : sorted[hi++]!;
    if (!visit(other, takeLo ? dLo : dHi)) return;
  }
}

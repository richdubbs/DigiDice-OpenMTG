/**
 * Whether a mana cost has only one way to be paid (client auto pay): the client pays such a cost at once instead of asking.
 * Ways are told apart by the NAMES of the sources tapped, not by which object: with two Mountains, {R} has one way (either Mountain is the same choice);
 * with a Mountain and a Forest, {1} has two. A source that can make several colors is one way whatever color it makes (the auto payer picks the color
 * the cost needs, CR 601.2g-h).
 *
 * A way is a minimal set of sources, counted per group of identical sources (same name, same mana abilities): it pays the cost (with the pool), and
 * leaving out any one of its sources would not. Never "only one way" when a Phyrexian symbol could be paid with life (CR 107.4f, 119.4: that is the
 * player's choice) or when the groups are too many to try.
 */
import type { ManaSymbol, ManaType } from '../types/mana';
import type { ManaRestriction } from '../types/ability';
import type { ObjectId } from '../types/ids';
import { isPhyrexian, solve } from './solver';
import { buildProviders, type ManaSource } from './sources';

/** At most this many count vectors are tried; beyond it the cost is treated as having several ways (the player is asked). */
const MAX_VECTORS = 4096;

type PoolUnit = { type: ManaType; snow?: boolean; restriction?: ManaRestriction; sourceId?: ObjectId };

export function hasOnlyOneWayToPay(
  symbols: readonly ManaSymbol[],
  sources: readonly ManaSource[],
  pool: readonly PoolUnit[],
  allows?: (r: ManaRestriction, manaSource: ObjectId | undefined) => boolean,
): boolean {
  if (symbols.some(isPhyrexian)) return false;
  const groups = new Map<string, ManaSource[]>();
  for (const s of sources) {
    const key = `${s.name}|${s.snow}|${JSON.stringify(s.modes.map((m) => [m.units, m.sacrifices, m.restriction ?? null]))}`;
    const g = groups.get(key);
    if (g) g.push(s);
    else groups.set(key, [s]);
  }
  const gs = [...groups.values()];
  if (gs.reduce((n, g) => n * (g.length + 1), 1) > MAX_VECTORS) return false;

  const memo = new Map<string, boolean>();
  const feasible = (k: readonly number[]): boolean => {
    const key = k.join(',');
    let ok = memo.get(key);
    if (ok === undefined) {
      const chosen = gs.flatMap((g, i) => g.slice(0, k[i]));
      ok = solve({ symbols: [...symbols], providers: buildProviders(chosen, pool, undefined, allows), life: 0 }) !== null;
      memo.set(key, ok);
    }
    return ok;
  };

  let ways = 0;
  const k = new Array<number>(gs.length).fill(0);
  const walk = (i: number): boolean => {
    if (i === gs.length) {
      if (!feasible(k)) return true;
      const minimal = k.every((n, j) => {
        if (n === 0) return true;
        k[j] = n - 1;
        const without = feasible(k);
        k[j] = n;
        return !without;
      });
      if (minimal) ways++;
      return ways < 2;
    }
    for (let n = 0; n <= gs[i]!.length; n++) {
      k[i] = n;
      if (!walk(i + 1)) return false;
    }
    k[i] = 0;
    return true;
  };
  walk(0);
  return ways === 1;
}

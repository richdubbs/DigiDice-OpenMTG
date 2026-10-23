/**
 * std-exile-play-2-3 (lane std-exile-play-2): `CardDesc`, a singular card description with no article or count of its own, the card a choice of "up to one" is
 * of ("Exile up to one noncreature, nonland card from that player's graveyard", CR 608.2d): the singular of `CardsDesc` (parser/holes/r4dig.ts), its value the
 * filter of the card described (no `isCard`, no `zone`: the template's pool says where the card is). A description with a flag (a property of a set) is no reading.
 */
import type { ObjectFilter } from '../../types/ability';
import type { Alt, HoleFn } from './core';
import { npAlts } from './filter';

export const cardDesc: HoleFn = (ctx, pos) => {
  const out: Alt[] = [];
  for (const n of npAlts(ctx, pos)) {
    if (n.number !== 'singular' || n.head !== 'card' || n.filter.zone !== undefined) continue;
    if (n.flags.some((f) => f !== 'zone-unstated')) continue;
    const { isCard: _isCard, ...filter } = n.filter as ObjectFilter;
    out.push({ end: n.end, value: filter, ...(n.weak ? { weak: n.weak } : {}) });
  }
  return out;
};

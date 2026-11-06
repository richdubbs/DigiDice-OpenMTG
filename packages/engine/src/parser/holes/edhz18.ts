/**
 * edh-zones-18 (Commander lane edh-zones): quantities over the cards an earlier reveal of the ability revealed.
 * CR cites checked against MagicCompRules 20260925.
 */
import type { Quantity } from '../../types/ability';
import type { Alt, HoleCtx } from './core';
import { P, anaphorObj, phraseAt } from './core';
import { npAlts, REVEALED_THIS_WAY } from './filter';

const W_REVEALED_THIS_WAY = P('revealed this way');

/**
 * CR 701.20a, 608.2c (Selvala, Explorer Returned): "for each nonland card revealed this way" counts the cards of that description that an earlier reveal step of the
 * ability revealed (the `revealed this way` group anaphor, counted in the library where they stay: no earlier instruction but reveals and looks, `Discourse.revealStays`; std-rx35 counts the cards a mill milled alike, holes/qty.ts#milledThisWayCount). Only right
 * after the words "for each" in front of this hole, one singular description of a card with no controller, owner or zone, and only after a reveal (the
 * discourse model says the sentences before it reveal and do nothing else with cards; the group itself is bound only by a reveal, so a look never answers it). Weak (design 6.3 rule 2).
 */
export function revealedThisWayCount(ctx: HoleCtx, pos: number): Alt[] {
  if (ctx.discourse?.revealStays !== true || ctx.toks[pos - 2]?.norm !== 'for' || ctx.toks[pos - 1]?.norm !== 'each') return [];
  const out: Alt[] = [];
  for (const n of npAlts(ctx, pos)) {
    if (n.number !== 'singular' || n.head !== 'card' || n.flags.some((f) => f !== 'zone-unstated')) continue;
    if (n.filter.controller !== undefined || n.filter.owner !== undefined || n.filter.zone !== undefined || n.filter.is !== undefined) continue;
    const e = phraseAt(ctx, n.end, W_REVEALED_THIS_WAY);
    if (e < 0) continue;
    const group = anaphorObj({ sort: 'set', number: 'plural', head: 'card', participle: REVEALED_THIS_WAY, text: 'revealed this way' });
    out.push({ end: e, value: { q: 'count', of: { ref: 'each', filter: { ...n.filter, is: group, zone: 'library' } } } as unknown as Quantity, weak: 1 });
  }
  return out;
}

/**
 * trek-17 (lane trek, Star Trek): quantities over the cards an earlier reveal of the ability revealed, when a draw came in between (the cards are in a hand then).
 * CR cites checked against MagicCompRules 20260925.
 */
import type { ObjectFilter, Quantity } from '../../types/ability';
import type { Alt, HoleCtx } from './core';
import { P, anaphorObj, anyPhraseAt, phraseAt } from './core';
import { npAlts, REVEALED_THIS_WAY } from './filter';

const W_REVEALED_THIS_WAY = P('revealed this way');
const W_THE_GREATEST_MV = [P('the greatest mana value among'), P('the highest mana value among')];
const W_CARDS_REVEALED_THIS_WAY = P('cards revealed this way');

/** The cards a reveal of the ability showed, wherever the resolution has put them since (a draw into a hand or the command zone, a replacement): CR 701.20a, 608.2c. */
const group = () => anaphorObj({ sort: 'set', number: 'plural', head: 'card', participle: REVEALED_THIS_WAY, text: 'revealed this way' });
const where = (g: unknown): ObjectFilter => ({ is: g, zone: 'any', isCard: true }) as unknown as ObjectFilter;

/**
 * CR 701.20a, 121.1, 608.2c (Ambassador K'Ehleyr): "For each nonland card revealed this way, put a +1/+1 counter on ~." after "each player reveals the top card of their library, then
 * draws a card": the cards of that description among the cards the reveal showed, counted where they are now (the discourse model says the sentences before it reveal and draw
 * and do nothing else with cards). Only right after the words "for each" in front of this hole, one singular description of a card with no controller, owner or zone. Weak (design 6.3 rule 2).
 */
export function revealedDrawnCount(ctx: HoleCtx, pos: number): Alt[] {
  if (ctx.discourse?.revealDrawn !== true || ctx.toks[pos - 2]?.norm !== 'for' || ctx.toks[pos - 1]?.norm !== 'each') return [];
  const out: Alt[] = [];
  for (const n of npAlts(ctx, pos)) {
    if (n.number !== 'singular' || n.head !== 'card' || n.flags.some((f) => f !== 'zone-unstated')) continue;
    if (n.filter.controller !== undefined || n.filter.owner !== undefined || n.filter.zone !== undefined || n.filter.is !== undefined) continue;
    const e = phraseAt(ctx, n.end, W_REVEALED_THIS_WAY);
    if (e < 0) continue;
    out.push({ end: e, value: { q: 'count', of: { ref: 'each', filter: { ...n.filter, ...where(group()) } } } as unknown as Quantity, weak: 1 });
  }
  return out;
}

/**
 * CR 202.3, 701.20a, 608.2c (Alexander, Ship's Fool): "the greatest mana value among cards revealed this way": the highest mana value among the cards an earlier reveal of the ability
 * showed, in the library or (drawn since) in a hand. Only after reveals, looks and draws (the discourse model); nothing is the greatest of no card (the evaluator gives 0).
 */
export function revealedGreatestMv(ctx: HoleCtx, pos: number): Alt[] {
  if (ctx.discourse?.revealDrawn !== true && ctx.discourse?.revealStays !== true) return [];
  const the = anyPhraseAt(ctx, pos, W_THE_GREATEST_MV);
  if (the < 0) return [];
  const e = phraseAt(ctx, the, W_CARDS_REVEALED_THIS_WAY);
  if (e < 0) return [];
  return [{ end: e, value: { q: 'stat', stat: 'manaValue', of: { ref: 'each', filter: where(group()) }, agg: 'max' } as unknown as Quantity }];
}

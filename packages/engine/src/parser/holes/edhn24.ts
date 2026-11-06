/**
 * edh-next-24 (Commander lane edh-next, template code edhn24): readings of the `Qty` hole.
 *  - "the number of colors that spell is" / "the number of colors it is" (CR 105.1, 105.2; Mana Cannons, Jared Carthalion): the different colors one object has
 *    (`distinct colors` among the one object the pronoun or "that spell" names; a colorless object has none, a multicolored one two or more).
 */
import type { Alt, HoleCtx } from './core';
import { P, anaphorObj, phraseAt } from './core';

const W_NUMBER_OF_COLORS = P('the number of colors');
const W_THAT_SPELL_IS = P('that spell is');
const W_THAT_CARD_IS = P('that card is');
const W_IT_IS = P('it is');

export function edhn24QtyAt(ctx: HoleCtx, pos: number): Alt[] {
  const out: Alt[] = [];
  const c = phraseAt(ctx, pos, W_NUMBER_OF_COLORS);
  if (c < 0) return out;
  const spell = phraseAt(ctx, c, W_THAT_SPELL_IS);
  if (spell >= 0) out.push({ end: spell, value: { q: 'distinct', what: 'colors', among: anaphorObj({ sort: 'object', number: 'singular', head: 'spell', text: 'that spell' }) } });
  const card = phraseAt(ctx, c, W_THAT_CARD_IS);
  if (card >= 0) out.push({ end: card, value: { q: 'distinct', what: 'colors', among: anaphorObj({ sort: 'object', number: 'singular', head: 'card', text: 'that card' }) } });
  const it = phraseAt(ctx, c, W_IT_IS);
  if (it >= 0) out.push({ end: it, value: { q: 'distinct', what: 'colors', among: anaphorObj({ sort: 'object', number: 'singular', text: 'it' }) } });
  return out;
}


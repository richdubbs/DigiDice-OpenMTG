/**
 * edh-next-31 (Commander EDHREC ranks 6,251-7,500, template code edhn31): readings of the `Qty` hole.
 *  - "of its colors" after "for each" (CR 105.1, 105.2; Breathe Your Last: "You gain 1 life for each of its colors"): one for each different color the one object the pronoun
 *    names has (`distinct colors` among it, as edh-next-24's "the number of colors it is"); a colorless object has none.
 */
import type { Alt, HoleCtx } from './core';
import { P, anaphorObj, phraseAt } from './core';

const W_OF_ITS_COLORS = P('of its colors');

export function edhn31QtyAt(ctx: HoleCtx, pos: number): Alt[] {
  const out: Alt[] = [];
  const e = phraseAt(ctx, pos, W_OF_ITS_COLORS);
  if (e >= 0) out.push({ end: e, value: { q: 'distinct', what: 'colors', among: anaphorObj({ sort: 'object', number: 'singular', text: 'its' }) } });
  return out;
}

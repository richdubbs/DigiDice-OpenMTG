/**
 * edh-next-38 (Commander EDHREC ranks 8,751-10,000, template code edhn38): readings of the `Qty` hole.
 *  - "the number of cards looked at while scrying this way" and, after "for each", "card looked at while scrying this way" (CR 701.22a, 603.2c; Celeborn the Wise,
 *    Elminster): the amount of the "whenever you scry" event, the cards the scry looked at (`{q:'eventAmount'}`; the scry action carries them as its `x`, triggers/normalize.ts).
 *    A number anaphor (participle `scried`) that parser/lower/quantities.ts resolves only in an ability that triggers on a scry (fail closed: the sentence is manual elsewhere).
 */
import type { Alt, HoleCtx } from './core';
import { P, phraseAt } from './core';

const SCRIED = { q: 'eventAmount', $anaphor: { sort: 'number', number: 'singular', participle: 'scried', text: 'looked at while scrying this way' } } as never;
const W_NUMBER_LOOKED = P('the number of cards looked at while scrying this way');
const W_EACH_LOOKED = P('card looked at while scrying this way');

export function edhn38QtyAt(ctx: HoleCtx, pos: number): Alt[] {
  const out: Alt[] = [];
  const n = phraseAt(ctx, pos, W_NUMBER_LOOKED);
  if (n >= 0) out.push({ end: n, value: SCRIED });
  if (ctx.toks[pos - 2]?.norm === 'for' && ctx.toks[pos - 1]?.norm === 'each') {
    const e = phraseAt(ctx, pos, W_EACH_LOOKED);
    if (e >= 0) out.push({ end: e, value: SCRIED });
  }
  return out;
}

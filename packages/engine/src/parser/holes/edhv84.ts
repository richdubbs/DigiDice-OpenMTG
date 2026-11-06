/**
 * edh-c-84 ADDITION: readings of the `Cond` hole (parser/holes/cond.ts#atoms):
 *  - "you own a card in exile" (CR 406.1, 108.3, 602.5b; Dreadlight Monstrosity): a card in exile has an owner, not a controller; the condition holds when one or more cards in
 *    exile are owned by you (the render side says it already, render/cond.ts, FAST5 T68).
 */
import type { Condition } from '../../types/ability';
import type { Alt, HoleCtx } from './core';
import { P, phraseAt } from './core';

const W_YOU_OWN_A_CARD_IN_EXILE = P('you own a card in exile');

export function edhv84CondAt(ctx: HoleCtx, pos: number): Alt[] {
  const out: Alt[] = [];
  const e = phraseAt(ctx, pos, W_YOU_OWN_A_CARD_IN_EXILE);
  if (e >= 0) out.push({ end: e, value: { cond: 'exists', of: { ref: 'each', filter: { zone: 'exile', owner: 'you' } } } as Condition });
  return out;
}

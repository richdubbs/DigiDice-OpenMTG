/**
 * edh-d-88 (Commander coordinator D, must-finish band 5,001-10,000, group combat; template code edhd88): readings of the `Qty` hole (parser/holes/qty.ts).
 *  - "the amount of {E} you have" (CR 107.14, 122.1; Razorfield Ripper: "it gets +X/+X until end of turn, where X is the amount of {E} you have"): the energy counters a player has now,
 *    the same count as "the number of energy counters you have" (`{ q: 'counters', on: <player>, kind: 'energy' }`, effects/eval.ts). The player is any `Player` reading followed by
 *    "have" or "has".
 */
import type { Alt, HoleCtx } from './core';
import { P, anyPhraseAt, phraseAt } from './core';

const W_AMOUNT_OF_ENERGY = P('the amount of {e}');
const W_HAS_OR_HAVE = [P('has'), P('have')];

export function edhd88QtyAt(ctx: HoleCtx, pos: number): Alt[] {
  const out: Alt[] = [];
  const e = phraseAt(ctx, pos, W_AMOUNT_OF_ENERGY);
  if (e < 0) return out;
  for (const r of ctx.call('Player', e)) {
    const h = anyPhraseAt(ctx, r.end, W_HAS_OR_HAVE);
    if (h >= 0) out.push({ end: h, value: { q: 'counters', on: r.value as never, kind: 'energy' } });
  }
  return out;
}

/**
 * edh-next-95 (top-rank second pass 3, template code edhn95): readings of the `Cond` hole (parser/holes/cond.ts#atoms).
 *  - "this card is suspended" (CR 702.62b; Deep-Sea Kraken, Greater Gargadon, Nihilith, Pardic Dragon, 17-Year Cicadas, Curse of the Cabal): the object itself is a card in exile that has suspend and
 *    a time counter on it (the same description as "suspended card", holes/filter.ts, p2-modal-1). A card in any other zone, or in exile with no time counter, is not suspended.
 */
import type { Condition } from '../../types/ability';
import type { Alt, HoleCtx } from './core';
import { P, phraseAt } from './core';

/**
 *  - "the number of players who have lost the game", and after "for each" "player who has lost the game" (CR 104.3, 800.4a; Rampant Frogantua, Hot Pursuit): `{q:'playersLost'}`, the players of
 *    the game that have lost it (players who left still count).
 */
const W_NUMBER_LOST = P('the number of players who have lost the game');
const W_EACH_LOST = P('player who has lost the game');
export function edhn95QtyAt(ctx: HoleCtx, pos: number): Alt[] {
  const out: Alt[] = [];
  const n = phraseAt(ctx, pos, W_NUMBER_LOST);
  if (n >= 0) out.push({ end: n, value: { q: 'playersLost' } as never });
  if (ctx.toks[pos - 2]?.norm === 'for' && ctx.toks[pos - 1]?.norm === 'each') {
    const e = phraseAt(ctx, pos, W_EACH_LOST);
    if (e >= 0) out.push({ end: e, value: { q: 'playersLost' } as never });
  }
  return out;
}

const W_IS_SUSPENDED = P('is suspended');

export function edhn95CondAt(ctx: HoleCtx, pos: number): Alt[] {
  const out: Alt[] = [];
  if (ctx.toks[pos]?.kind === 'SELF') {
    const e = phraseAt(ctx, pos + 1, W_IS_SUSPENDED);
    if (e >= 0) out.push({ end: e, value: { cond: 'matches', object: { ref: 'self' }, filter: { zone: 'exile', keyword: 'suspend', counters: { kind: 'time' } } } as Condition });
  }
  return out;
}

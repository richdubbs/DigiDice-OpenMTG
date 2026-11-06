/**
 * edh-next-110 (concept lane tokens-counters, template code edhn110): readings of the `Qty` hole (parser/holes/qty.ts#atoms).
 *  - "[for each | the number of] +1/+1 counter(s) you've put on creatures under your control this turn" (CR 122.6, 122.6a, 400.7; Iridescent Hornbeetle): the counters of that kind that
 *    you put on permanents of the description this turn, added up from the history (the `counters` entries' `amount`, the putter recorded as `by`; the permanent matched as it was
 *    when the counters were put). `{q:'happenedCount', event:{ev:'counters', change:'put', kind, on, by:'you'}, scope:'turn', sum:'amount'}`.
 */
import type { Condition, ObjectFilter, Quantity } from '../../types/ability';
import type { Alt, HoleCtx } from './core';
import { P, anyPhraseAt, phraseAt } from './core';

const W_COUNTER_YOUVE_PUT_ON = [P("counter you've put on"), P("counters you've put on")];
const W_CREATURES_UNDER_YOUR_CONTROL = P('creatures under your control');
const W_THIS_TURN = P('this turn');
const W_THE_NUMBER_OF = P('the number of');

export function edhn110QtyAt(ctx: HoleCtx, pos: number): Alt[] {
  const out: Alt[] = [];
  const forEach = ctx.toks[pos - 2]?.norm === 'for' && ctx.toks[pos - 1]?.norm === 'each';
  let at = pos;
  if (!forEach) {
    const n = phraseAt(ctx, pos, W_THE_NUMBER_OF);
    if (n < 0) return out;
    at = n;
  }
  for (const k of ctx.call('CounterKind', at)) {
    const put = anyPhraseAt(ctx, k.end, W_COUNTER_YOUVE_PUT_ON);
    if (put < 0) continue;
    const on = phraseAt(ctx, put, W_CREATURES_UNDER_YOUR_CONTROL);
    const th = on >= 0 ? phraseAt(ctx, on, W_THIS_TURN) : -1;
    if (th < 0) continue;
    const filter: ObjectFilter = { types: ['Creature'], controller: 'you' };
    const value: Quantity = { q: 'happenedCount', event: { ev: 'counters', change: 'put', kind: k.value as never, on: filter, by: 'you' }, scope: 'turn', sum: 'amount' };
    out.push({ end: th, value });
  }
  return out;
}

/**
 *  - "a creature or planeswalker an opponent controlled was dealt excess damage this turn" (CR 120.10, 120.4a, 400.7, 603.4; Rith, Liberated Primeval): a damage entry of this turn whose recipient was a
 *    creature or planeswalker an opponent controlled as the damage was dealt and whose `excess` part was above 0 (rules/history.ts, `damage` with `excess`). It counts even if the permanent has
 *    left the battlefield or changed controllers since (Scryfall ruling 2022-09-09).
 */
const W_EXCESS_OPP = P('a creature or planeswalker an opponent controlled was dealt excess damage this turn');
export function edhn110CondAt(ctx: HoleCtx, pos: number): Alt[] {
  const e = phraseAt(ctx, pos, W_EXCESS_OPP);
  if (e < 0) return [];
  const value: Condition = { cond: 'happened', event: { ev: 'damage', recipient: { object: { types: ['Creature', 'Planeswalker'], controller: 'opponent' } }, excess: true }, scope: 'turn' };
  return [{ end: e, value }];
}

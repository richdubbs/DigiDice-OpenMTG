/**
 * edh-next-111 (concept lane combat-r2, template code edhn111): readings of the `Cond` hole (parser/holes/cond.ts#atoms).
 *  - "its mana value is odd" / "that card's mana value is even" (CR 202.3, 107.1; Yennett, Cryptic Sovereign): the object's mana value has that parity (zero is even; filter `manaValueParity`). An object and a mana value
 *    only (the "it" anaphor or an object phrase).
 */
import type { Condition } from '../../types/ability';
import type { Alt, HoleCtx } from './core';
import { P, anaphorObj, phraseAt } from './core';

export function edhn111CondAt(ctx: HoleCtx, pos: number): Alt[] {
  const out: Alt[] = [];
  // "its mana value is odd", "that card's mana value is even"
  const parity = (e: number, object: unknown): void => {
    const w = ctx.toks[e]?.norm;
    if (w === 'odd' || w === 'even') out.push({ end: e + 1, value: { cond: 'matches', object, filter: { manaValueParity: w } } as Condition });
  };
  if (ctx.toks[pos]?.norm === 'its') {
    const e = phraseAt(ctx, pos + 1, P('mana value is'));
    if (e >= 0) parity(e, anaphorObj({ sort: 'object', number: 'singular', text: 'it' }));
  }
  for (const o of ctx.call('Obj', pos)) {
    const e = phraseAt(ctx, o.end, P("'s mana value is"));
    if (e >= 0) parity(e, o.value);
  }
  return out;
}

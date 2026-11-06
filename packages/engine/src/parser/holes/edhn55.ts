/**
 * edh-next-55 ADDITION (Commander lane dice): readings of the `Cond` hole (parser/holes/cond.ts#atoms) about the die the trigger or the instruction just rolled.
 *  - "the roll was 4 or higher" / "you rolled 6 or higher" (CR 706.2, 603.4, 608.2h; Monoxa, Midway Manager; Mr. House): the result of the roll is at least that number (or at most,
 *    "or lower"); `dieResult` reads the result of the roll of this resolution, else the triggering roll's (effects/eval.ts). Whole numbers of one or more only.
 *  - "it has the greatest power or is tied for greatest power among creatures on the battlefield" (CR 208.1, 608.2c; Strength-Testing Hammer): the power of the object the ability named is
 *    at least that of every creature on the battlefield (itself included). Power and toughness.
 */
import type { Condition, ObjRef, Quantity } from '../../types/ability';
import type { Alt, HoleCtx } from './core';
import { P, anaphorObj, numberAt, phraseAt } from './core';

const W_THE_ROLL_WAS = P('the roll was');
const W_YOU_ROLLED = P('you rolled');
const W_OR_HIGHER = P('or higher');
const W_OR_LOWER = P('or lower');

const W_ANY_OF_THOSE_RESULTS_WAS = P('any of those results was');

export function edhn55CondAt(ctx: HoleCtx, pos: number): Alt[] {
  const out: Alt[] = [];
  // edh-d-49 (CR 706.2, 603.2c, 608.2h; Farideh, Devil's Chosen): "any of those results was 10 or higher": the highest result of the dice just rolled is at least that number
  const any = phraseAt(ctx, pos, W_ANY_OF_THOSE_RESULTS_WAS);
  const anyN = any >= 0 ? numberAt(ctx, any) : undefined;
  if (any >= 0 && anyN !== undefined && Number.isInteger(anyN) && anyN >= 1) {
    const hi = phraseAt(ctx, any + 1, W_OR_HIGHER);
    if (hi >= 0) out.push({ end: hi, value: { cond: 'compare', left: { q: 'dieResultHighest' }, op: '>=', right: anyN } as Condition });
  }
  for (const w of [W_THE_ROLL_WAS, W_YOU_ROLLED]) {
    const e = phraseAt(ctx, pos, w);
    const n = e >= 0 ? numberAt(ctx, e) : undefined;
    if (e < 0 || n === undefined || !Number.isInteger(n) || n < 1) continue;
    const hi = phraseAt(ctx, e + 1, W_OR_HIGHER);
    const lo = hi < 0 ? phraseAt(ctx, e + 1, W_OR_LOWER) : -1;
    if (hi >= 0) out.push({ end: hi, value: { cond: 'compare', left: { q: 'dieResult' }, op: '>=', right: n } as Condition });
    if (lo >= 0) out.push({ end: lo, value: { cond: 'compare', left: { q: 'dieResult' }, op: '<=', right: n } as Condition });
  }
  return out;
}

const W_IT_HAS_THE_GREATEST = P('it has the greatest');
const W_OR_IS_TIED_FOR_GREATEST = P('or is tied for greatest');
const W_AMONG_CREATURES_ON_BF = P('among creatures on the battlefield');

/** "it has the greatest power or is tied for greatest power among creatures on the battlefield": a power (toughness) at least the most of any creature on the battlefield. */
export function greatestOrTied(ctx: HoleCtx, pos: number): Alt[] {
  const out: Alt[] = [];
  const g = phraseAt(ctx, pos, W_IT_HAS_THE_GREATEST);
  if (g < 0) return out;
  for (const stat of ['power', 'toughness'] as const) {
    const w = phraseAt(ctx, g, P(stat));
    const t = w >= 0 ? phraseAt(ctx, w, W_OR_IS_TIED_FOR_GREATEST) : -1;
    const w2 = t >= 0 ? phraseAt(ctx, t, P(stat)) : -1;
    const end = w2 >= 0 ? phraseAt(ctx, w2, W_AMONG_CREATURES_ON_BF) : -1;
    if (end < 0) continue;
    const it = anaphorObj({ sort: 'object', number: 'singular', text: 'it' }) as unknown as ObjRef;
    const creatures: ObjRef = { ref: 'each', filter: { types: ['Creature'] } };
    const left: Quantity = { q: 'stat', stat, of: it };
    const right: Quantity = { q: 'stat', stat, of: creatures, agg: 'max' };
    out.push({ end, value: { cond: 'compare', left, op: '>=', right } as Condition });
  }
  return out;
}

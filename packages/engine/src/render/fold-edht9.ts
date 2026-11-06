/**
 * edh-top-9: the folds of its readings, called from render/fold.ts#foldAt.
 *
 * `thenInstructionUnlessPay` (CR 118.12a, 608.2c; Volatile Stormdrake): "You get {E}{E}{E}{E}, then sacrifice that creature unless you pay an amount of {E} equal to its mana value." is the energy gain
 * (said "you get", never "get", inside an "if you do") followed by a payment that guards the NEXT instruction only (`pay` with one `else` step): the first instruction is done whatever the payment (the "unless" is the last
 * instruction's, parser/chart.ts#paysBeforeItsIf drops the reading that makes both depend on it). Only a payment of yours, offered once, with nothing but the `else`.
 */
import type { EffectStep } from '../types/ability';
import type { Folded } from './fold';
import { K } from './kernel';
import type { RenderState } from './state';

const same = (a: unknown, b: unknown): boolean => JSON.stringify(a) === JSON.stringify(b);

function thenInstructionUnlessPay(list: EffectStep[], i: number, st: RenderState): Folded | null {
  const a = list[i];
  const p = list[i + 1];
  // (only the energy gain: the other instructions are joined to a payment by the general joiner, render/steps.ts, which the fold would only narrow)
  if (a?.op !== 'putCounters' || a.kind !== 'energy' || !same(a.on, { ref: 'you' }) || p?.op !== 'pay' || a.guard !== undefined) return null;
  if (!same(p.who, { ref: 'you' }) || p.mandatory === true || p.times !== undefined || p.then !== undefined || p.else === undefined || p.else.length !== 1 || p.guard !== undefined) return null;
  const first = K.clause(a, st);
  if (first.standalone === true) return null;
  const second = K.clause(p, st);
  return { clauses: [{ ...first, imp: `${first.imp}, then ${second.imp}`, sub: `${first.sub}, then ${second.imp}`, standalone: true }], consumed: 2 };
}

export function foldEdhT9(list: EffectStep[], i: number, st: RenderState): Folded | null {
  return thenInstructionUnlessPay(list, i, st);
}

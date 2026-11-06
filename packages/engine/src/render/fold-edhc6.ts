/**
 * edh-c-6 (Commander effort, EDHREC ranks 18,126 to 18,750): the folds of its templates (parser/templates/zz-cloud/edh-c-6.json), called from render/fold.ts#foldAt.
 *
 * `threeCounterTargets` (CR 122.1, 608.2c, 115.3; Incremental Growth): "Put a +1/+1 counter on target creature, two +1/+1 counters on another target creature, and three +1/+1
 * counters on a third target creature." The three `putCounters` steps of template eff.edhv6.counters.put.threeObjects, each on a target (no guard, no name), a whole number of one kind.
 */
import type { EffectStep, ObjRef } from '../types/ability';
import type { Folded } from './fold';
import { plain } from './clause';
import { K } from './kernel';
import type { RenderState } from './state';
import { countersText } from './steps-life';

function threeCounterTargets(list: EffectStep[], i: number, st: RenderState): Folded | null {
  const puts: Extract<EffectStep, { op: 'putCounters' }>[] = [];
  for (let k = 0; k < 3; k++) {
    const e = list[i + k];
    if (e?.op !== 'putCounters' || e.on.ref !== 'target' || e.guard !== undefined || e.as !== undefined || e.upTo === true || e.distribute === true || e.kindOfChoice !== undefined || e.by !== undefined) return null;
    if (typeof e.count !== 'number' || e.count < 1 || typeof e.kind !== 'string') return null;
    if (st.specs.get(e.on.id)?.divide !== undefined) return null;
    puts.push(e);
  }
  if (new Set(puts.map((e) => (e.on as { id: string }).id)).size !== 3) return null; // three different targets
  // (nothing is rendered, and so no reference is marked as said, until all three steps fit)
  const parts = puts.map((e) => `${countersText(e.count as number, e.kind as string, st)} on ${K.obj(e.on as ObjRef, st, 'object').text}`);
  return { clauses: [plain(`put ${parts[0]}, ${parts[1]}, and ${parts[2]}`, { standalone: true })], consumed: 3 };
}

/** The folds of edh-c-6 (render/fold.ts#foldAt). */
export function foldEdhC6(list: EffectStep[], i: number, st: RenderState): Folded | null {
  return threeCounterTargets(list, i, st);
}

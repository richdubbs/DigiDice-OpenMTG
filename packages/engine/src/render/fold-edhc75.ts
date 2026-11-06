/**
 * edh-c-75 (Commander lane edh-c, EDHREC ranks 27,501-28,000, second pass): the folds of its templates (parser/templates/zz-cloud/edh-c-75.json), called from render/fold.ts#foldAt.
 *
 * `colorThenAttacksThisTurn` (CR 508.1d, 611.2a, 613.1e, 105.3; eff.edhv75.becomesColor.andAttacks; Incite): "Target creature becomes red until end of turn and attacks this turn if able.":
 * a change of colors of an object until end of turn, then the requirement that the same object attacks this turn, said as one sentence with the subject once. Only that shape: a
 * color change of one reference and a plain `mustIfAble` attack of that same reference, nothing else on either step.
 */
import type { EffectStep } from '../types/ability';
import { plain } from './clause';
import type { Folded } from './fold';
import { K } from './kernel';
import type { RenderState } from './state';

function colorThenAttacksThisTurn(list: EffectStep[], i: number, st: RenderState): Folded | null {
  const a = list[i];
  const b = list[i + 1];
  if (a?.op !== 'effect' || b?.op !== 'effect' || a.guard !== undefined || b.guard !== undefined || a.as !== undefined || b.as !== undefined) return null;
  if (a.effects.length !== 1 || b.effects.length !== 1 || a.duration.d !== 'endOfTurn' || b.duration.d !== 'endOfTurn') return null;
  if (Object.keys(a).sort().join(',') !== 'duration,effects,op' || Object.keys(b).sort().join(',') !== 'duration,effects,op') return null;
  const c = a.effects[0]!;
  const r = b.effects[0]!;
  if (c.s !== 'continuous' || c.mods.length !== 1 || c.mods[0]!.layer !== 5 || c.mods[0]!.colors === undefined) return null;
  if (r.s !== 'restrict' || r.mode !== 'mustIfAble' || r.action !== 'attack' || r.other !== undefined || r.otherPlayer !== undefined || r.max !== undefined || r.when !== undefined) return null;
  if (JSON.stringify(r.subject) !== JSON.stringify(c.affects)) return null;
  const color = K.clause(a, st);
  return { clauses: [plain(`${color.sub} and attacks this turn if able`, { standalone: true })], consumed: 2 };
}

export function foldEdhC75(list: EffectStep[], i: number, st: RenderState): Folded | null {
  return colorThenAttacksThisTurn(list, i, st);
}

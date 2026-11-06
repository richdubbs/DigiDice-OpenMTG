/**
 * edh-players-15 (Commander lane edh-players): the folds of its templates (parser/templates/zz-cloud/edh-players-15.json), called from render/fold.ts#foldAtPlain.
 *
 * `selfAndObjPumpGrantMustAttack` (CR 508.1d, 611.2a, 613.1f, 613.4c; Gogo, Mysterious Mime, eff.edhp15.selfAndObj.pumpgrant.mustAttack): "~ and that creature each get +2/+0 and gain
 * haste until end of turn and attack this turn if able.": a pump and grant of the union of the object itself and one other object for a while, then the requirement that both attack
 * this turn (a requirement of its own duration, the end of the turn), said as one sentence with the two subjects once. Only that shape: nothing else on either step.
 */
import type { EffectStep } from '../types/ability';
import { plain } from './clause';
import type { Folded } from './fold';
import { K } from './kernel';
import type { RenderState } from './state';

const same = (a: unknown, b: unknown): boolean => JSON.stringify(a) === JSON.stringify(b);

function selfAndObjPumpGrantMustAttack(list: EffectStep[], i: number, st: RenderState): Folded | null {
  const a = list[i];
  const b = list[i + 1];
  if (a?.op !== 'effect' || b?.op !== 'effect' || a.guard !== undefined || b.guard !== undefined || a.as !== undefined || b.as !== undefined) return null;
  if (a.effects.length !== 1 || b.effects.length !== 1 || b.duration.d !== 'endOfTurn' || Object.keys(b).sort().join(',') !== 'duration,effects,op') return null;
  const g = a.effects[0]!;
  const r = b.effects[0]!;
  if (g.s !== 'continuous' || g.mods.length !== 2 || g.mods[0]!.layer !== '7c' || g.mods[1]!.layer !== 6 || g.mods[1]!.add === undefined) return null;
  if (g.affects.ref !== 'union' || g.affects.of.length !== 2 || !same(g.affects.of[0], { ref: 'self' })) return null;
  if (r.s !== 'restrict' || r.mode !== 'mustIfAble' || r.action !== 'attack' || r.other !== undefined || r.otherPlayer !== undefined || r.max !== undefined || r.when !== undefined) return null;
  if (!same(r.subject, g.affects)) return null;
  // the pump and grant clause says the pair once ("~ and that creature each get ... until end of turn", render/mods.ts); the requirement is its tail
  const grant = K.clause(a, st);
  return { clauses: [plain(`${grant.sub} and attack this turn if able`, { standalone: true })], consumed: 2 };
}

export function foldEdhP15(list: EffectStep[], i: number, st: RenderState): Folded | null {
  return selfAndObjPumpGrantMustAttack(list, i, st);
}

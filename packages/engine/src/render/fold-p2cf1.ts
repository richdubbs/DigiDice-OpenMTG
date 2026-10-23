/**
 * p2-combat-flow-1 (Phase 2 lane p2-combat-flow): the folds of its templates (parser/templates/zz-cloud/p2-combat-flow-1.json), called from
 * render/fold.ts#foldAt.
 *
 * `toughnessDamageThisTurn` (CR 510.1a, 611.2a, 611.2c; eff.p2cf1.toughnessDamage.thisTurn): "target creature you control assigns combat damage equal to its
 * toughness rather than its power this turn" (Plagon, Lord of the Beach): the rule of one object for the rest of the turn, said of that object.
 */
import type { EffectStep, ObjRef } from '../types/ability';
import { plain } from './clause';
import type { Folded } from './fold';
import { K } from './kernel';
import type { RenderState } from './state';

function toughnessDamageThisTurn(list: EffectStep[], i: number, st: RenderState): Folded | null {
  const a = list[i];
  if (a?.op !== 'effect' || a.guard !== undefined || a.effects.length !== 1 || a.duration.d !== 'endOfTurn' || Object.keys(a).sort().join(',') !== 'duration,effects,op') return null;
  const r = a.effects[0]!;
  if (r.s !== 'rule' || r.rule !== 'combatDamageUsesToughness' || r.onlyIf !== undefined || r.of === undefined || Object.keys(r).length !== 3) return null;
  const f = r.of as { is?: ObjRef };
  if (f.is === undefined || Object.keys(f).length !== 1 || f.is.ref === 'each') return null;
  return { clauses: [plain(`${K.obj(f.is, st, 'subject').text} assigns combat damage equal to its toughness rather than its power this turn`, { standalone: true })], consumed: 1 };
}

/** The folds of p2-combat-flow-1, tried before the shared ones (render/fold.ts#foldAt). */
export function foldP2CombatFlow1(list: EffectStep[], i: number, st: RenderState): Folded | null {
  return toughnessDamageThisTurn(list, i, st);
}

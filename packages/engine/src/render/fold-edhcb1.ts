/**
 * edh-combat-1 (Commander lane edh-combat): the folds of its templates (parser/templates/zz-cloud/edh-combat-1.json), called from render/fold.ts#foldAt.
 *
 * `grantThenAttacksThisCombat` (CR 508.1d, 611.2a, 611.2c, 613.1f; eff.edhcb1.grant.attacksThisCombat; Legion Warboss): "That token gains haste until end of turn and
 * attacks this combat if able.": a grant of abilities to an object for a while, then the requirement that the same object attacks this combat (a requirement of its own
 * duration, the end of the combat), said as one sentence with the subject once. Only that shape: a grant and a requirement of one reference, nothing else on either step.
 */
import type { EffectStep } from '../types/ability';
import { plain } from './clause';
import type { Folded } from './fold';
import { K } from './kernel';
import type { RenderState } from './state';

function grantThenAttacksThisCombat(list: EffectStep[], i: number, st: RenderState): Folded | null {
  const a = list[i];
  const b = list[i + 1];
  if (a?.op !== 'effect' || b?.op !== 'effect' || a.guard !== undefined || b.guard !== undefined || a.as !== undefined || b.as !== undefined) return null;
  if (a.effects.length !== 1 || b.effects.length !== 1 || b.duration.d !== 'endOfCombat' || Object.keys(b).sort().join(',') !== 'duration,effects,op') return null;
  const g = a.effects[0]!;
  const r = b.effects[0]!;
  if (g.s !== 'continuous' || g.mods.length !== 1 || g.mods[0]!.layer !== 6 || g.mods[0]!.add === undefined) return null;
  if (r.s !== 'restrict' || r.mode !== 'mustIfAble' || r.action !== 'attack' || r.other !== undefined || r.otherPlayer !== undefined || r.max !== undefined || r.when !== undefined) return null;
  if (JSON.stringify(r.subject) !== JSON.stringify(g.affects)) return null;
  const grant = K.clause(a, st);
  return { clauses: [plain(`${grant.sub} and attacks this combat if able`, { standalone: true })], consumed: 2 };
}

/**
 * `pumpThenAttacksThisTurn` (edh-c-37; CR 508.1d, 611.2a, 613.4c; eff.edhv37.pump.attacksThisTurn; Chemister's Trick): "Target creature you don't control gets -2/-0 until end of turn
 * and attacks this turn if able.": a power/toughness change of an object for a while, then the requirement that the same object attacks this turn (a requirement of its own
 * duration, the end of the turn), said as one sentence with the subject once. Only that shape, as the fold above.
 */
function pumpThenAttacksThisTurn(list: EffectStep[], i: number, st: RenderState): Folded | null {
  const a = list[i];
  const b = list[i + 1];
  if (a?.op !== 'effect' || b?.op !== 'effect' || a.guard !== undefined || b.guard !== undefined || a.as !== undefined || b.as !== undefined) return null;
  if (a.effects.length !== 1 || b.effects.length !== 1 || b.duration.d !== 'endOfTurn' || Object.keys(b).sort().join(',') !== 'duration,effects,op') return null;
  const g = a.effects[0]!;
  const r = b.effects[0]!;
  if (g.s !== 'continuous' || g.mods.length !== 1 || g.mods[0]!.layer !== '7c') return null;
  if (r.s !== 'restrict' || r.mode !== 'mustIfAble' || r.action !== 'attack' || r.other !== undefined || r.otherPlayer !== undefined || r.max !== undefined || r.when !== undefined) return null;
  if (JSON.stringify(r.subject) !== JSON.stringify(g.affects)) return null;
  if (!['target', 'self', 'bound', 'event', 'attachedTo'].includes(g.affects.ref)) return null; // one object: a group "attack" ("Those creatures attack this turn if able.") is its own sentence
  const pump = K.clause(a, st);
  return { clauses: [plain(`${pump.sub} and attacks this turn if able`, { standalone: true })], consumed: 2 };
}

export function foldEdhCb1(list: EffectStep[], i: number, st: RenderState): Folded | null {
  return grantThenAttacksThisCombat(list, i, st) ?? pumpThenAttacksThisTurn(list, i, st);
}

/**
 * edh-c-14 (coordinator C, EDHREC ranks 16,251-16,875): the folds of its templates (parser/templates/zz-cloud/edh-c-14.json), called from render/fold.ts#foldAt.
 *
 * `attacksPlayerThisCombat` (CR 508.1d, 611.2a; eff.edhv14.obj.attacksPlayer.thisCombat; Ruhan of the Fomori): "~ attacks that player this combat if able.": a requirement
 * of one object to attack a named player for the rest of the combat (`mustIfAble` attack with `otherPlayer`, the end of the combat). Only that shape: nothing else on the
 * requirement or the step.
 */
import type { EffectStep } from '../types/ability';
import { plain } from './clause';
import type { Folded } from './fold';
import { K } from './kernel';
import type { RenderState } from './state';

function attacksPlayerThisCombat(list: EffectStep[], i: number, st: RenderState): Folded | null {
  const a = list[i];
  if (a?.op !== 'effect' || a.guard !== undefined || a.as !== undefined || a.effects.length !== 1 || a.duration.d !== 'endOfCombat' || Object.keys(a).sort().join(',') !== 'duration,effects,op') return null;
  const r = a.effects[0]!;
  if (r.s !== 'restrict' || r.mode !== 'mustIfAble' || r.action !== 'attack' || r.otherPlayer === undefined || r.other !== undefined || r.max !== undefined || r.min !== undefined || r.when !== undefined) return null;
  if (Object.keys(r).filter((k) => !['s', 'subject', 'mode', 'action', 'otherPlayer'].includes(k) && (r as unknown as Record<string, unknown>)[k] !== undefined).length > 0) return null;
  const sub = K.obj(r.subject as never, st, 'subject');
  const who = K.player(r.otherPlayer, st, 'object');
  return { clauses: [plain(`${sub.text} ${sub.plural ? 'attack' : 'attacks'} ${who.text} this combat if able`, { standalone: true })], consumed: 1 };
}

export function foldEdhV14(list: EffectStep[], i: number, st: RenderState): Folded | null {
  return attacksPlayerThisCombat(list, i, st);
}

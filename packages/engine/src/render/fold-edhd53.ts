/**
 * edh-d-53 (coordinator D, lane d-rank-3, EDHREC ranks 15,001-16,500): the folds of its templates (parser/templates/zz-cloud/edh-d-53.json), called from render/fold.ts#foldAt.
 *
 * `attacksPlayerEachCombatDur` (CR 508.1d, 611.2a; eff.edhd53.obj.attacksPlayer.eachCombat.dur; Silver Surfer, Galactus's Herald): "Until the end of your next turn, target creature
 * attacks that player each combat if able.": a requirement of one object to attack a named player in each combat of a duration (`mustIfAble` attack with `otherPlayer`). Only that
 * shape (any duration but the end of this combat, which is `eff.edhv14.obj.attacksPlayer.thisCombat`'s): nothing else on the requirement or the step.
 */
import type { EffectStep } from '../types/ability';
import { plain } from './clause';
import type { Folded } from './fold';
import { K } from './kernel';
import type { RenderState } from './state';

function attacksPlayerEachCombatDur(list: EffectStep[], i: number, st: RenderState): Folded | null {
  const a = list[i];
  if (a?.op !== 'effect' || a.guard !== undefined || a.as !== undefined || a.effects.length !== 1 || a.duration.d === 'endOfCombat' || Object.keys(a).sort().join(',') !== 'duration,effects,op') return null;
  const r = a.effects[0]!;
  if (r.s !== 'restrict' || r.mode !== 'mustIfAble' || r.action !== 'attack' || r.otherPlayer === undefined || r.other !== undefined || r.max !== undefined || r.min !== undefined || r.when !== undefined) return null;
  if (Object.keys(r).filter((k) => !['s', 'subject', 'mode', 'action', 'otherPlayer'].includes(k) && (r as unknown as Record<string, unknown>)[k] !== undefined).length > 0) return null;
  const lead = K.dur(a.duration, st);
  const sub = K.obj(r.subject as never, st, 'subject');
  const who = K.player(r.otherPlayer, st, 'object');
  return { clauses: [plain(`${lead}, ${sub.text} ${sub.plural ? 'attack' : 'attacks'} ${who.text} each combat if able`, { standalone: true })], consumed: 1 };
}

export function foldEdhD53(list: EffectStep[], i: number, st: RenderState): Folded | null {
  return attacksPlayerEachCombatDur(list, i, st);
}

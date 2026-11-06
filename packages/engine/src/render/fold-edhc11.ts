/**
 * edh-c-11 (Commander lane edh-c, second pass of EDHREC ranks 16,876 to 17,500): the folds of its readings (parser/templates/zz-cloud/edh-c-11.json), called from
 * render/fold.ts#foldAt. Each applies only when every part is exactly what the idiom says.
 *
 * `leadPumpAndLure` (CR 611.2a, 611.2c, 509.1c, 613.4c; Revenge of the Hunted): "Until end of turn, target creature gets +6/+6 and gains trample, and all creatures able to block it
 * this turn do so.": two effects of one duration (end of turn), a change of the object and the requirement of every creature to block that same object. The duration is said once, in front.
 */
import type { EffectStep, Modification, ObjRef } from '../types/ability';
import { plain } from './clause';
import type { Folded } from './fold';
import { K } from './kernel';
import { abilityList, continuous } from './mods';
import type { RenderState } from './state';

const same = (a: unknown, b: unknown): boolean => JSON.stringify(a) === JSON.stringify(b);

function leadPumpAndLure(list: EffectStep[], i: number, st: RenderState): Folded | null {
  const [a, b] = [list[i], list[i + 1]];
  if (a?.op !== 'effect' || b?.op !== 'effect' || !same(a.duration, { d: 'endOfTurn' }) || !same(b.duration, a.duration) || a.effects.length !== 1 || b.effects.length !== 1) return null;
  if (a.guard !== undefined || b.guard !== undefined || a.as !== undefined || b.as !== undefined) return null;
  const [pump, lure] = [a.effects[0]!, b.effects[0]!];
  if (pump.s !== 'continuous' || pump.cda === true || !pump.mods.some((m) => m.layer === 6) || !pump.mods.some((m) => m.layer === '7c') || lure.s !== 'restrict' || lure.mode !== 'mustIfAble' || lure.action !== 'block' || lure.other === undefined || lure.when !== undefined || lure.max !== undefined) return null;
  if (!same(lure.subject, { ref: 'each', filter: { types: ['Creature'] } }) || !same(lure.other, { is: pump.affects })) return null;
  const lead = K.dur(a.duration, st);
  const change = continuous(pump, st, undefined, false);
  const must = K.staticEffect(lure, st, { duration: b.duration });
  return { clauses: [plain(`${lead}, ${change}, and ${must}`, { standalone: true })], consumed: 2 };
}

/**
 * `gainsAndBecomesColorlessArtifact` (CR 611.2a, 613.1d-f, 205.1b; Xathrid Gorgon, eff.edhv11.gains.becomes.colorlessArtifact): "It gains defender and becomes a colorless artifact in addition to
 * its other types.": one effect with no duration (it lasts for the rest of the game) of one object, three modifications: the artifact type added, the color set to none, abilities added.
 */
function gainsAndBecomesColorlessArtifact(list: EffectStep[], i: number, st: RenderState): Folded | null {
  const e = list[i];
  if (e?.op !== 'effect' || !same(e.duration, { d: 'permanent' }) || e.effects.length !== 1 || e.guard !== undefined || e.as !== undefined) return null;
  const c = e.effects[0]!;
  if (c.s !== 'continuous' || c.cda === true || c.mods.length !== 3 || c.mods[0]?.layer !== 4 || c.mods[1]?.layer !== 5 || c.mods[2]?.layer !== 6) return null;
  const [types, color, grant] = c.mods as [Modification, Modification, Modification];
  if (!same(types, { layer: 4, types: { add: ['Artifact'] } }) || !same(color, { layer: 5, colors: { set: [] } }) || grant.layer !== 6 || Object.keys(grant).some((k) => k !== 'layer' && k !== 'add') || grant.add === undefined || grant.add.length === 0) return null;
  const subj = K.obj(c.affects as ObjRef, st, 'subject');
  if (subj.plural) return null;
  return { clauses: [plain(`${subj.text} gains ${abilityList(grant.add, st, 'creature')} and becomes a colorless artifact in addition to its other types`, { standalone: true })], consumed: 1 };
}

export function foldEdhC11(list: EffectStep[], i: number, st: RenderState): Folded | null {
  return leadPumpAndLure(list, i, st) ?? gainsAndBecomesColorlessArtifact(list, i, st);
}

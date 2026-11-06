/**
 * edh-next-146 (must-finish round, group "other"): the folds of its templates (parser/templates/zz-cloud/edh-next-146.json), called from render/fold.ts#foldAt. Each applies only when every
 * part is exactly what the idiom says, with no guard, name or link on any step it does not expect.
 */
import type { EffectStep, ObjRef } from '../types/ability';
import { plain } from './clause';
import type { Folded } from './fold';
import { K } from './kernel';
import type { RenderState } from './state';

const same = (a: unknown, b: unknown): boolean => JSON.stringify(a) === JSON.stringify(b);

/** The ability a layer 6 removal string names, as Oracle says it: a keyword's name, or "<land type>walk" for one landwalk ("landwalk:swamp", CR 702.14c). */
const removedWords = (r: string): string => (r.startsWith('landwalk:') && /^[a-z]+$/.test(r.slice('landwalk:'.length)) ? `${r.slice('landwalk:'.length)}walk` : r);

/**
 * `losesOneOfChoice` (CR 608.2d, 611.2c, 613.1f, 702.7a, 702.14c; Urborg, eff.edhn146.loses.firstStrikeOrSwampwalk, ruling 2009-10-01): "Target creature loses first strike or swampwalk until end of
 * turn.": the controller chooses, as the ability resolves, which of the two abilities the object loses (a creature with both loses only the chosen one), then one fixed removal per answer.
 * Exactly a `chooseValue` of the controller among two answers, then for each answer in order one `if` that removes exactly that ability from the same object for the same duration.
 */
function losesOneOfChoice(list: EffectStep[], i: number, st: RenderState): Folded | null {
  const c = list[i];
  if (c?.op !== 'chooseValue' || c.what !== 'option' || c.link === undefined || !same(c.who, { ref: 'you' }) || c.guard !== undefined || c.random !== undefined || c.secret !== undefined) return null;
  const answers = c.options ?? [];
  if (answers.length !== 2) return null;
  let first: Extract<EffectStep, { op: 'effect' }> | null = null;
  for (let k = 0; k < answers.length; k++) {
    const b = list[i + 1 + k];
    if (b?.op !== 'if' || b.else !== undefined || b.guard !== undefined || b.as !== undefined || b.then.length !== 1) return null;
    if (b.cond.cond !== 'chosen' || b.cond.link !== c.link || b.cond.equals !== answers[k]) return null;
    const e = b.then[0]!;
    if (e.op !== 'effect' || e.effects.length !== 1 || e.guard !== undefined || e.as !== undefined) return null;
    const ce = e.effects[0]!;
    if (ce.s !== 'continuous' || ce.cda !== undefined || ce.mods.length !== 1) return null;
    const m = ce.mods[0]!;
    if (m.layer !== 6 || m.add !== undefined || m.removeAll !== undefined || m.cantHave !== undefined || m.remove?.length !== 1 || removedWords(m.remove[0]!) !== answers[k]) return null;
    if (first === null) first = e;
    else if (!same(e.duration, first.duration) || !same(ce.affects, (first.effects[0] as typeof ce).affects)) return null;
  }
  const ce = first!.effects[0]!;
  if (ce.s !== 'continuous') return null;
  const subj = K.obj(ce.affects as ObjRef, st, 'subject');
  const dur = K.dur(first!.duration, st);
  if (subj.plural || !dur) return null;
  return { clauses: [plain(`${subj.text} loses ${answers[0]} or ${answers[1]} ${dur}`)], consumed: 3 };
}

export function foldEdhN146(list: EffectStep[], i: number, st: RenderState): Folded | null {
  return losesOneOfChoice(list, i, st);
}

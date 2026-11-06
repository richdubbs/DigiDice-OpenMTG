/**
 * edh-perms-16 (Commander lane edh-perms): the folds of its templates (parser/templates/zz-cloud/edh-perms-16.json), called from render/fold.ts#foldAt.
 *
 * `yourChoiceOfCounts` (CR 122.1, 608.2d; Inspirit, Flagship Vessel): "Put your choice of a +1/+1 counter or two charge counters on up to one other target artifact."
 * The controller chooses one of two kinds as the ability resolves, then the branch of the kind chosen puts that many counters of it on the same object. Exactly the
 * three steps of template eff.edhpm16.counters.yourChoiceOfCounts (two different kinds, a whole number of each).
 */
import type { EffectStep, ObjRef } from '../types/ability';
import type { Folded } from './fold';
import { plain } from './clause';
import { K } from './kernel';
import type { RenderState } from './state';
import { countersText } from './steps-life';

const same = (a: unknown, b: unknown): boolean => JSON.stringify(a) === JSON.stringify(b);

function yourChoiceOfCounts(list: EffectStep[], i: number, st: RenderState): Folded | null {
  const c = list[i];
  if (c?.op !== 'chooseValue' || c.link === undefined || c.who.ref !== 'you' || c.guard !== undefined || c.what !== 'option' || c.min !== undefined || c.max !== undefined || c.exclude !== undefined) return null;
  const kinds = c.options ?? [];
  if (kinds.length !== 2 || kinds[0] === kinds[1]) return null;
  const puts: { text: string; on: ObjRef; count: number }[] = [];
  for (let k = 0; k < 2; k++) {
    const b = list[i + 1 + k];
    if (b?.op !== 'if' || b.else !== undefined || b.guard !== undefined || b.as !== undefined || b.then.length !== 1) return null;
    if (b.cond.cond !== 'chosen' || b.cond.link !== c.link || b.cond.equals !== kinds[k]) return null;
    const e = b.then[0]!;
    if (e.op !== 'putCounters' || e.kind !== kinds[k] || typeof e.count !== 'number' || e.count < 1 || e.guard !== undefined || e.as !== undefined || e.upTo === true || e.distribute === true || e.kindOfChoice !== undefined) return null;
    puts.push({ text: countersText(e.count, e.kind, st), on: e.on as ObjRef, count: e.count });
  }
  if (!same(puts[0]!.on, puts[1]!.on) || puts[0]!.on.ref === 'each') return null;
  // one counter of each kind is the older idiom of render/fold-stddsk.ts#choiceCounter (with or without "your choice of"): left to it
  if (puts.every((x) => x.count === 1)) return null;
  const on = puts[0]!.on;
  if (on.ref === 'target' && st.specs.get(on.id)?.divide !== undefined) return null;
  if (list.slice(i + 3).some((s) => JSON.stringify(s).includes(`"${c.link}"`))) return null;
  return { clauses: [plain(`put your choice of ${puts[0]!.text} or ${puts[1]!.text} on ${K.obj(on, st, 'object').text}`, { standalone: true })], consumed: 3 };
}

/** The folds of edh-perms-16 (render/fold.ts#foldAt). */
export function foldEdhPm16(list: EffectStep[], i: number, st: RenderState): Folded | null {
  return yourChoiceOfCounts(list, i, st);
}

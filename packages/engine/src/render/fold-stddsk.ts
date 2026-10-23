/**
 * Cloud std-dsk (the Duskmourn slice of the Standard backlog): folds of adjacent steps that Oracle writes as one idiom (render/fold.ts#foldAt calls
 * `foldStdDsk` last). A fold applies only when every part is exactly what the idiom says.
 */
import type { EffectStep, ObjRef, PlayerRef } from '../types/ability';
import { plain } from './clause';
import type { Folded } from './fold';
import { K } from './kernel';
import { isPlayerRef } from './refs';
import type { RenderState } from './state';
import { alt, joinList, withArticle } from './text';

/** Does this node read the link (a `link` or `chosen` field naming it)? */
function readsLink(x: unknown, link: string): boolean {
  if (Array.isArray(x)) return x.some((y) => readsLink(y, link));
  if (typeof x !== 'object' || x === null) return false;
  return Object.entries(x).some(([k, v]) => ((k === 'link' || k === 'chosen') && v === link) || readsLink(v, link));
}

/**
 * "put a flying, lifelink, or +1/+1 counter on it", "put your choice of a reach, menace, or trample counter on target creature" (CR 122.1, 122.1b, 608.2d):
 * the controller chooses one of the listed kinds as the ability resolves (chooseValue among the kinds), then one branch per kind, in the order listed, each
 * putting exactly one counter of that kind on the same object. "your choice of" and "a reach counter, a vigilance counter, or a trample counter" are
 * other wordings of the same choice. The fold applies only when every part is exactly that and nothing after it reads the choice.
 */
function choiceCounter(list: EffectStep[], i: number, st: RenderState): Folded | null {
  const c = list[i];
  if (c?.op !== 'chooseValue' || c.link === undefined || c.who.ref !== 'you' || c.guard !== undefined || c.what !== 'option' || c.min !== undefined || c.max !== undefined || c.exclude !== undefined) return null;
  const kinds = c.options ?? [];
  if (kinds.length < 2 || new Set(kinds).size !== kinds.length) return null;
  let on: ObjRef | null = null;
  for (let k = 0; k < kinds.length; k++) {
    const b = list[i + 1 + k];
    if (b?.op !== 'if' || b.else !== undefined || b.guard !== undefined || b.as !== undefined || b.then.length !== 1) return null;
    if (b.cond.cond !== 'chosen' || b.cond.link !== c.link || b.cond.equals !== kinds[k]) return null;
    const e = b.then[0]!;
    if (e.op !== 'putCounters' || e.kind !== kinds[k] || e.count !== 1 || e.guard !== undefined || e.as !== undefined) return null;
    if (on === null) on = e.on as ObjRef;
    else if (JSON.stringify(e.on) !== JSON.stringify(on)) return null;
  }
  if (on === null || isPlayerRef(on as ObjRef | PlayerRef, st)) return null;
  if (on.ref === 'target' && st.specs.get(on.id)?.divide !== undefined) return null;
  if (list.slice(i + 1 + kinds.length).some((s) => readsLink(s, c.link!))) return null;
  const what = K.obj(on, st, 'object').text;
  const shared = withArticle(`${joinList(kinds, 'or')} counter`);
  const each = joinList(kinds.map((k) => withArticle(`${k} counter`)), 'or');
  return { clauses: [plain(`put ${alt(shared, `your choice of ${shared}`, `your choice of ${each}`)} on ${what}`)], consumed: 1 + kinds.length };
}

/** The std-dsk folds, in order. */
export function foldStdDsk(list: EffectStep[], i: number, st: RenderState): Folded | null {
  return choiceCounter(list, i, st);
}

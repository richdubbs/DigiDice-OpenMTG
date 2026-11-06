/**
 * Cloud std-dsk (the Duskmourn slice of the Standard backlog): folds of adjacent steps that Oracle writes as one idiom (render/fold.ts#foldAt calls
 * `foldStdDsk` last). A fold applies only when every part is exactly what the idiom says.
 */
import type { EffectStep, ObjRef, PlayerRef } from '../types/ability';
import { plain } from './clause';
import type { Folded } from './fold';
import { K } from './kernel';
import { isPlayerRef } from './refs';
import { cloneState, type RenderState } from './state';
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
 * other wordings of the same choice (edh-cast-6: "put a +1/+1 counter or a loyalty counter on it", the kinds each with its word "counter" and no "your choice of"). The fold applies only when every part is exactly that and nothing after it reads the choice.
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
  return { clauses: [plain(`put ${alt(shared, `your choice of ${shared}`, `your choice of ${each}`, each, kinds.length >= 3 ? `your choice of a counter from among ${joinList(kinds, 'and')}` /* edhn63 (Aragorn, Company Leader) */ : shared)} on ${what}`)], consumed: 1 + kinds.length };
}

/**
 * edh-next-137 (CR 122.1, 122.1b, 608.2d; Elspeth Resplendent): "Put a +1/+1 counter and a counter from among flying, first strike, lifelink, or vigilance on it.": one
 * counter of the first kind on the object, then the controller's choice of one listed kind on the same object (the choice fold above, read with "a counter from among").
 * Only a putCounters of exactly one counter followed by that choice of three or more kinds, on the same object.
 */
function putThenChoiceCounter(list: EffectStep[], i: number, st: RenderState): Folded | null {
  const p = list[i];
  if (p?.op !== 'putCounters' || p.count !== 1 || p.guard !== undefined || p.as !== undefined || typeof p.kind !== 'string') return null;
  const c = list[i + 1];
  if (c?.op !== 'chooseValue' || (c.options ?? []).length < 3 || (c.options ?? []).includes(p.kind)) return null;
  const rest = choiceCounter(list, i + 1, cloneState(st)); // (checked on a copy: the object is said once, below)
  if (rest === null) return null;
  const b = list[i + 2];
  if (b?.op !== 'if' || b.then[0]?.op !== 'putCounters' || JSON.stringify(b.then[0].on) !== JSON.stringify(p.on)) return null;
  const what = K.obj(p.on as ObjRef, st, 'object').text;
  return { clauses: [plain(`put ${withArticle(`${p.kind} counter`)} and a counter from among ${joinList(c.options!, 'or')} on ${what}`)], consumed: 1 + rest.consumed };
}

/** The std-dsk folds, in order. */
export function foldStdDsk(list: EffectStep[], i: number, st: RenderState): Folded | null {
  return choiceCounter(list, i, st) ?? putThenChoiceCounter(list, i, st);
}

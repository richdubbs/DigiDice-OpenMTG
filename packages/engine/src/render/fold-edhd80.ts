/**
 * edh-d-80 (Commander coordinator D, lane must-finish-5000; code edhd80): the fold of one instruction list, called from render/fold.ts#foldAt.
 */
import type { EffectStep, ObjRef } from '../types/ability';
import { plain } from './clause';
import type { Folded } from './fold';
import { K } from './kernel';
import type { RenderState } from './state';

const same = (a: unknown, b: unknown): boolean => JSON.stringify(a) === JSON.stringify(b);

/**
 * `untapGoadItAndIt` (CR 701.26b, 701.15a, 608.2c; Slicer, Hired Muscle): one object untapped, goaded by you and then given a lasting effect of its own, three instructions
 * on the same object in one list: "untap ~, goad it, and it can't be sacrificed this turn". The third is a resolved `effect` whose every part is about that object (its
 * restriction's subject or its change's object), so its clause is about "it" (the object said once, then the pronoun). Only that exact shape; the two-step
 * "untap and goad <obj>" (render/fold-edhn19.ts) keeps its wording.
 */
function untapGoadItAndIt(list: EffectStep[], i: number, st: RenderState): Folded | null {
  const a = list[i];
  const b = list[i + 1];
  const c = list[i + 2];
  if (a?.op !== 'untap' || b?.op !== 'action' || b.action !== 'goad' || c?.op !== 'effect') return null;
  if (Object.keys(a).some((k) => k !== 'op' && k !== 'what') || Object.keys(b).some((k) => !['op', 'action', 'who', 'subject'].includes(k))) return null;
  if (!same(b.who, { ref: 'you' }) || !same(a.what, b.subject) || a.what.ref === 'each') return null;
  if (Object.keys(c).some((k) => !['op', 'duration', 'effects'].includes(k)) || c.effects.length === 0) return null;
  if (!c.effects.every((e) => (e.s === 'restrict' && same(e.subject, a.what)) || (e.s === 'continuous' && same(e.affects, a.what)))) return null;
  const obj = K.obj(a.what as ObjRef, st, 'object').text;
  const third = K.clause(c, st);
  if (third.standalone === true) return null;
  return { clauses: [plain(`untap ${obj}, goad it, and ${third.imp}`, { standalone: true })], consumed: 3 };
}

/** The folds of edh-d-80 (render/fold.ts#foldAt). */
export function foldEdhD80(list: EffectStep[], i: number, st: RenderState): Folded | null {
  return untapGoadItAndIt(list, i, st);
}

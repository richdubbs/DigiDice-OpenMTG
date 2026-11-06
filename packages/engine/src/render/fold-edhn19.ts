/**
 * edh-next-19 (Commander lane edh-next, EDHREC ranks 11,251-12,500, fourth pass): the folds of its templates (parser/templates/zz-cloud/edh-next-19.json), called from
 * render/fold.ts#foldAt.
 */
import type { EffectStep, ObjRef } from '../types/ability';
import { plain } from './clause';
import type { Folded } from './fold';
import { K } from './kernel';
import type { RenderState } from './state';

const same = (a: unknown, b: unknown): boolean => JSON.stringify(a) === JSON.stringify(b);

/**
 * `untapAndGoad` (CR 701.26b, 701.15a; Besmirch; eff.edhn19.untapAndGoad): an object untapped and then goaded by you, "Untap and goad that creature." Only that exact shape.
 */
function untapAndGoad(list: EffectStep[], i: number, st: RenderState): Folded | null {
  const a = list[i];
  const b = list[i + 1];
  if (a?.op !== 'untap' || b?.op !== 'action' || b.action !== 'goad' || a.guard !== undefined || b.guard !== undefined || a.as !== undefined || b.as !== undefined) return null;
  if (!same(b.who, { ref: 'you' }) || !same(a.what, b.subject) || Object.keys(a).some((k) => k !== 'op' && k !== 'what') || Object.keys(b).some((k) => !['op', 'action', 'who', 'subject'].includes(k))) return null;
  if (a.what.ref === 'each') return null;
  return { clauses: [plain(`untap and goad ${K.obj(a.what as ObjRef, st, 'object').text}`, { standalone: true })], consumed: 2 };
}

/** The folds of edh-next-19 (render/fold.ts#foldAt). */
export function foldEdhN19(list: EffectStep[], i: number, st: RenderState): Folded | null {
  return untapAndGoad(list, i, st);
}

/**
 * edh-d-64 (Commander lane each-player, fourth pass): the folds of its templates (parser/templates/zz-cloud/edh-d-64.json), called from render/fold.ts#foldAt.
 */
import type { EffectStep } from '../types/ability';
import { plain } from './clause';
import type { Folded } from './fold';
import { K } from './kernel';
import type { RenderState } from './state';

const same = (a: unknown, b: unknown): boolean => JSON.stringify(a) === JSON.stringify(b);

/**
 * `tapAndGoad` (CR 701.26a, 701.15a; Fell Beast's Shriek; eff.edhd64.tapAndGoad): an object tapped and then goaded by you, "Tap and goad those creatures." Only that exact shape.
 */
function tapAndGoad(list: EffectStep[], i: number, st: RenderState): Folded | null {
  const a = list[i];
  const b = list[i + 1];
  if (a?.op !== 'tap' || b?.op !== 'action' || b.action !== 'goad' || a.guard !== undefined || b.guard !== undefined || a.as !== undefined || b.as !== undefined) return null;
  if (!same(b.who, { ref: 'you' }) || !same(a.what, b.subject) || Object.keys(a).some((k) => k !== 'op' && k !== 'what') || Object.keys(b).some((k) => !['op', 'action', 'who', 'subject'].includes(k))) return null;
  if (a.what.ref !== 'bound') return null; // ("tap target creature and goad it" keeps its own wording: Karazikar, Killian)
  return { clauses: [plain(`tap and goad ${K.obj(a.what, st, 'object').text}`, { standalone: true })], consumed: 2 };
}

/** The folds of edh-d-64 (render/fold.ts#foldAt). */
export function foldEdhD64(list: EffectStep[], i: number, st: RenderState): Folded | null {
  return tapAndGoad(list, i, st);
}

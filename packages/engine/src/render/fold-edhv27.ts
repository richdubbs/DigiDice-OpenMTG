/**
 * edh-c-27 (Commander EDHREC ranks 21,501-22,000): the folds of its templates (parser/templates/zz-cloud/edh-c-27.json), called from render/fold.ts#foldAt.
 *
 * `drawThenDiscardThatMany` (CR 121.1, 701.9a, 608.2c; Laquatus's Creativity): "Target player draws cards equal to the number of cards in their hand, then discards that many
 * cards." The draw names how many cards were drawn; the discard counts them. Exactly the two steps of template eff.edhv27.draw.thenDiscardThatMany, for a TARGET player only (the same steps of the controller are edh-b-13's "discard 1 card for each card drawn this way").
 */
import type { EffectStep } from '../types/ability';
import { plain } from './clause';
import type { Folded } from './fold';
import { K } from './kernel';
import type { RenderState } from './state';

const same = (a: unknown, b: unknown): boolean => JSON.stringify(a) === JSON.stringify(b);

function drawThenDiscardThatMany(list: EffectStep[], i: number, st: RenderState): Folded | null {
  const a = list[i];
  const b = list[i + 1];
  if (a?.op !== 'draw' || b?.op !== 'discard' || a.as === undefined || a.guard !== undefined || b.guard !== undefined || b.as !== undefined || a.upTo !== undefined) return null;
  if (a.who.ref !== 'target' || !same(a.who, b.who) || b.filter !== undefined || b.mode !== undefined || b.cantAs !== undefined) return null;
  if (!same(b.count, { q: 'resultCount', step: a.as })) return null;
  if (list.slice(i + 2).some((x) => JSON.stringify(x).includes(`"${a.as}"`))) return null;
  const { as: _as, ...bare } = a;
  const first = K.clause(bare as EffectStep, st);
  if (first.empty) return null;
  return { clauses: [plain(`${first.sub}, then discards that many cards`, { standalone: true })], consumed: 2 };
}

/** The folds of edh-c-27 (render/fold.ts#foldAt). */
export function foldEdhV27(list: EffectStep[], i: number, st: RenderState): Folded | null {
  return drawThenDiscardThatMany(list, i, st);
}

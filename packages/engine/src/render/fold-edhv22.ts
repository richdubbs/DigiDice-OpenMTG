/**
 * edh-c-22 (Commander lane edh-c, EDHREC ranks 16,251-16,875): the folds of its templates (parser/templates/zz-cloud/edh-c-22.json), called from render/fold.ts#foldAt.
 *
 * `playerOrControllerDiscards` (CR 115.1, 109.4, 701.9a; eff.edhv22.discard.playerOrPlaneswalkerController; Blightning): "That player or that planeswalker's controller discards two
 * cards" after "target player or planeswalker": the same discard once for the target if it is a player and once for the controller of the target if it is a planeswalker (one
 * target; exactly one of the two steps has anybody to act). Only that shape: two unguarded `discard` steps of the same count, the first for the target, the second for its controller.
 */
import type { EffectStep } from '../types/ability';
import type { Folded } from './fold';
import { plain } from './clause';
import { K } from './kernel';
import type { RenderState } from './state';

const same = (a: unknown, b: unknown): boolean => JSON.stringify(a) === JSON.stringify(b);

function playerOrControllerDiscards(list: EffectStep[], i: number, st: RenderState): Folded | null {
  const a = list[i];
  const b = list[i + 1];
  if (a?.op !== 'discard' || b?.op !== 'discard' || a.guard !== undefined || b.guard !== undefined) return null;
  if (a.who.ref !== 'target' || b.who.ref !== 'controllerOf' || !same(b.who, { ref: 'controllerOf', object: { ref: 'target', id: a.who.id } })) return null;
  const { who: _wa, ...restA } = a;
  const { who: _wb, ...restB } = b;
  if (!same(restA, restB) || a.mode !== undefined) return null;
  // edh-d-14 (Rakdos's Return): the count may be X ("discards X cards"), the same quantity for both players; any other count that is not a positive number or {q:'X'} stays a manual step
  if (!((typeof a.count === 'number' && a.count >= 1) || (typeof a.count === 'object' && a.count !== null && (a.count as { q?: string }).q === 'X'))) return null;
  const who = K.player(a.who, st, 'subject').text;
  const whose = K.obj(b.who.object, st, 'possessive').text;
  const cards = a.count === 1 ? 'a card' : `${K.qty(a.count, st)} cards`;
  return { clauses: [plain(`${who} or ${whose} controller discards ${cards}`, { standalone: true })], consumed: 2 };
}

/** The folds of edh-c-22 (render/fold.ts#foldAt). */
export function foldEdhV22(list: EffectStep[], i: number, st: RenderState): Folded | null {
  return playerOrControllerDiscards(list, i, st);
}

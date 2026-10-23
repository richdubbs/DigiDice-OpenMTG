/**
 * p2-dig-1 (Phase 2 lane p2-dig): the folds of its templates (parser/templates/zz-cloud/p2-dig-1.json), called from render/fold.ts#foldAt. As every fold, one applies
 * only when every part is exactly what the idiom says (same players, bound names, nothing else in between).
 */
import type { EffectStep } from '../types/ability';
import { acting } from './clause';
import type { Folded } from './fold';
import { K } from './kernel';
import { playerKey, type RenderState } from './state';

const same = (a: unknown, b: unknown): boolean => JSON.stringify(a) === JSON.stringify(b);

/**
 * "Look at the top three cards of target player's library, then put them back in any order." (Portent, Natural Selection; CR 401.4, 701.20e): you look at the top
 * cards of ANOTHER player's library, then exactly those cards go back on top of it in an order YOU choose (`arrangedBy` you: the effect says who arranges them, not
 * the owner). The look by you and the move of exactly that binding, back on top with no other destination field. FAST2 T10's lookThenPutBack covers your own library.
 */
function lookThenPutBackArrangedByYou(list: EffectStep[], i: number, st: RenderState): Folded | null {
  const a = list[i];
  const b = list[i + 1];
  if (a?.op !== 'look' || a.guard !== undefined || a.as === undefined || a.who.ref !== 'you' || a.at.ref !== 'topCards' || playerKey(a.at.player) === playerKey(a.who)) return null;
  if (b?.op !== 'move' || b.guard !== undefined || b.as !== undefined || b.until !== undefined || b.link !== undefined || !same(b.what, { ref: 'bound', name: a.as })) return null;
  if (!same(b.to, { zone: 'library', position: 'top', order: 'chosen', arrangedBy: { ref: 'you' } })) return null;
  const ca = K.clause(a, st);
  const info = st.info.get(`b:${a.as}`);
  if (info === undefined || !info.plural) return null;
  const what = K.obj(b.what, st, 'object').text;
  return { clauses: [ca, acting('you', `put ${what} back in any order`, `you put ${what} back in any order`)], consumed: 2 };
}

/** The folds of p2-dig-1 (render/fold.ts#foldAt). */
export function foldP2Dig1(list: EffectStep[], i: number, st: RenderState): Folded | null {
  return lookThenPutBackArrangedByYou(list, i, st);
}

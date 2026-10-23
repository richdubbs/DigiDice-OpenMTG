/**
 * std-costs-2 (lane std-costs): the folds of its templates (parser/templates/zz-cloud/std-costs-2.json), called from render/fold.ts#foldAt.
 *
 * `searchPutInsteadOfHand` (CR 701.23a, 608.2c, 614.15): "Search your library for a creature card with mana value X or less, reveal it, put it into your hand, then
 * shuffle. If C, put that card onto the battlefield instead of putting it into your hand." The parser's rider rid.stdcosts2.putOntoBattlefieldInstead replaces the move
 * of the found card to the hand by "if C, put it onto the battlefield under your control, otherwise into your hand" (parser/lower/riders.ts, `@names`), before the
 * shuffle. Only that exact shape: a search of your library for ONE card that it reveals, the `if` on that card, then your shuffle; the card is also "the revealed card"
 * in C. The same steps keep the wording the other folds give them ("Put it onto the battlefield if C. Otherwise, put it into your hand.", r5-refs): family
 * put-instead-of-hand.
 */
import type { EffectStep } from '../types/ability';
import { plain } from './clause';
import type { Folded } from './fold';
import { K } from './kernel';
import { cloneState, type RenderState } from './state';
import { alt } from './text';

function searchPutInsteadOfHand(list: EffectStep[], i: number, st: RenderState): Folded | null {
  const [s, f, sh] = [list[i], list[i + 1], list[i + 2]];
  if (s?.op !== 'search' || s.as === undefined || s.reveal !== true || s.max !== 1 || s.zone !== 'library' || s.guard !== undefined || s.who.ref !== 'you') return null;
  if (f?.op !== 'if' || f.guard !== undefined || f.as !== undefined || f.then.length !== 1 || f.else?.length !== 1) return null;
  const [bf, hand] = [f.then[0]!, f.else[0]!];
  const found = JSON.stringify({ ref: 'bound', name: s.as });
  if (bf.op !== 'move' || hand.op !== 'move' || JSON.stringify(bf.what) !== found || JSON.stringify(hand.what) !== found || bf.as !== undefined || hand.as !== undefined || bf.guard !== undefined || hand.guard !== undefined) return null;
  if (JSON.stringify(bf.to) !== JSON.stringify({ zone: 'battlefield', controller: { ref: 'you' } }) || JSON.stringify(hand.to) !== JSON.stringify({ zone: 'hand' }) || bf.until !== undefined || hand.until !== undefined) return null;
  if (sh?.op !== 'shuffle' || sh.guard !== undefined || JSON.stringify(sh.who) !== JSON.stringify({ ref: 'you' })) return null;
  if (JSON.stringify(list.slice(i + 3)).includes(found)) return null;
  if (inside) return null;
  // the same three steps as the other folds say them ("Put it onto the battlefield if C. Otherwise, put it into your hand. Then shuffle."), on a copy of the state
  inside = true;
  let usual: string;
  try {
    usual = K.steps(list.slice(i, i + 3), cloneState(st));
  } finally {
    inside = false;
  }
  const head = K.steps([s, hand, sh], st);
  const info = st.info.get(`b:${s.as}`);
  if (info === undefined) return null;
  st.info.set(`b:${s.as}`, { ...info, alts: [...new Set([...(info.alts ?? []), 'the revealed card'])] });
  const cond = K.cond(f.cond, st);
  return { clauses: [plain(alt(`${head}. if ${cond}, put that card onto the battlefield instead of putting it into your hand`, usual), { standalone: true })], consumed: 3 };
}

/** The fold is being bypassed for its own other reading (searchPutInsteadOfHand renders the same steps once more, without it). */
let inside = false;

export function foldStdCosts2(list: EffectStep[], i: number, st: RenderState): Folded | null {
  return searchPutInsteadOfHand(list, i, st);
}

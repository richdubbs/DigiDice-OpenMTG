/**
 * edh-d-15 (Commander lane edh-d): the fold of its template eff.edhd15.eachPlayer.revealTop.loseMv.putHand (parser/templates/zz-cloud/edh-d-15.json), called from render/fold.ts#foldAt.
 *
 * (CR 701.20a, 119.3, 608.2c, 101.4; Duskmantle Seer): "Each player reveals the top card of their library, loses life equal to that card's mana value, then puts it into their
 * hand.": for each player, in turn, the card they reveal, the life they lose and the move of that very card into their hand (not a draw, CR 121.1). Exactly the loop the template builds.
 */
import type { EffectStep } from '../types/ability';
import { plain } from './clause';
import type { Folded } from './fold';
import type { RenderState } from './state';

const same = (a: unknown, b: unknown): boolean => JSON.stringify(a) === JSON.stringify(b);
const IT = { ref: 'iterating' };

function eachPlayerRevealLoseMvPutHand(list: EffectStep[], i: number, _st: RenderState): Folded | null {
  const s = list[i];
  if (s?.op !== 'forEach' || s.guard !== undefined || s.gather !== undefined || !same(s.over, { ref: 'each', who: 'player' }) || s.do.length !== 3) return null;
  const [r, l, m] = s.do;
  if (r?.op !== 'reveal' || l?.op !== 'loseLife' || m?.op !== 'move' || typeof r.as !== 'string' || r.guard !== undefined || l.guard !== undefined || m.guard !== undefined) return null;
  if (r.to !== undefined || !same(r.who, IT) || !same(r.what, { ref: 'topCards', player: IT, count: 1 })) return null;
  const card = { ref: 'bound', name: r.as };
  if (!same(l.who, IT) || !same(l.amount, { q: 'stat', stat: 'manaValue', of: card })) return null;
  if (!same(m.what, card) || !same(m.to, { zone: 'hand' }) || m.as !== undefined || m.until !== undefined || m.link !== undefined) return null;
  return { clauses: [plain("each player reveals the top card of their library, loses life equal to that card's mana value, then puts it into their hand", { standalone: true })], consumed: 1 };
}

/** The folds of edh-d-15 (render/fold.ts#foldAt). */
export function foldEdhD15(list: EffectStep[], i: number, st: RenderState): Folded | null {
  return eachPlayerRevealLoseMvPutHand(list, i, st);
}

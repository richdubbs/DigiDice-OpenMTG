/**
 * Commander lane dice, second pass, round edh-d-49: the folds of the steps its templates build (render/fold.ts#foldAt tries `foldEdhD49` after the other slices' own folds). A fold
 * applies only when every part is exactly what the idiom says. Imports nothing from render/fold.ts (an import cycle).
 */
import type { EffectStep } from '../types/ability';
import { plain } from './clause';
import type { Folded } from './fold';
import type { RenderState } from './state';

const LINKED_CARDS = JSON.stringify({ is: { ref: 'linked', link: 'exiled' }, zone: 'any', isCard: true });

/**
 * "Return up to X cards from among cards exiled with ~ to their owners' hands, where X is the result." (Bag of Devouring; CR 607.2a, 608.2d, 400.3, 706.2): you choose at
 * most that many of the cards a linked exile instruction exiled, any number down to none, and each goes to its owner's hand. Exactly the two steps the template
 * eff.edhd49.linked.returnUpToX.ownersHands.result builds (X the result of the die just rolled).
 */
function linkedReturnUpTo(list: EffectStep[], i: number, _st: RenderState): Folded | null {
  const a = list[i];
  const m = list[i + 1];
  if (a?.op !== 'chooseObjects' || a.as === undefined || a.min !== 0 || a.random !== undefined || a.guard !== undefined || a.who.ref !== 'you' || a.groupLimit !== undefined) return null;
  if (a.perPlayer !== undefined || a.startingWith !== undefined || a.eachCardType !== undefined || a.link !== undefined || a.distinct !== undefined || a.damageSource !== undefined) return null;
  if (a.from.ref !== 'each' || !('filter' in a.from) || JSON.stringify(a.from.filter) !== LINKED_CARDS) return null;
  if (m?.op !== 'move' || m.guard !== undefined || m.as !== undefined || m.until !== undefined || m.link !== undefined || m.remember !== undefined || m.what.ref !== 'bound' || m.what.name !== a.as) return null;
  if (JSON.stringify(m.to) !== '{"zone":"hand"}' || list.slice(i + 2).some((x) => JSON.stringify(x).includes(JSON.stringify(a.as)))) return null;
  const tail = "cards from among cards exiled with ~ to their owners' hands";
  if (typeof a.max === 'object' && JSON.stringify(a.max) === '{"q":"dieResult"}') return { clauses: [plain(`return up to x ${tail}, where x is the result`, { standalone: true })], consumed: 2 };
  return null;
}

/** The folds of edh-d-49 (render/fold.ts#foldAt). */
export function foldEdhD49(list: EffectStep[], i: number, st: RenderState): Folded | null {
  return linkedReturnUpTo(list, i, st);
}

/**
 * Lane p2-group-actions, round p2-group-actions-2: the fold of the steps its templates build (render/fold.ts#foldAt tries `foldP2GroupActions2` after the other
 * slices' own folds). A fold applies only when every part is exactly what the idiom says.
 */
import type { EffectStep } from '../types/ability';
import { plain } from './clause';
import type { Folded } from './fold';
import { K } from './kernel';
import type { RenderState } from './state';
import { bind } from './steps-util';
import { alt } from './text';

const same = (a: unknown, b: unknown): boolean => JSON.stringify(a) === JSON.stringify(b);
const ITERATING = { ref: 'iterating' };

/**
 * "Each opponent may put a creature card from their hand onto the battlefield." (Iwamori of the Open Fist; CR 101.4, 608.2d, 110.2a): each opponent in APNAP order
 * chooses up to one of the described cards in their own hand, then every card chosen is put onto the battlefield at the same time under its owner's control.
 * "Each other player" is the same set of players (no teams; family each-other-player-opponent). Exactly the two steps of template
 * eff.p2ga2.eachOpponent.may.putFromHand.bf.
 */
function eachOpponentMayPutOneFromHand(list: EffectStep[], i: number, st: RenderState): Folded | null {
  const a = list[i];
  const b = list[i + 1];
  if (a?.op !== 'chooseObjects' || a.guard !== undefined || a.random !== undefined || a.groupLimit !== undefined || a.startingWith !== undefined || a.min !== 0 || a.max !== 1) return null;
  if (!same(a.who, ITERATING) || !same(a.perPlayer, { ref: 'each', who: 'opponent' }) || a.from.ref !== 'each') return null;
  const f = a.from.filter;
  if (f.anyOf?.length !== 1 || f.zone !== 'hand' || !same(f.owner, ITERATING) || f.isCard !== true || Object.keys(f).some((k) => !['anyOf', 'zone', 'owner', 'isCard'].includes(k))) return null;
  if (b?.op !== 'move' || b.guard !== undefined || b.as !== undefined || b.until !== undefined || b.link !== undefined || !same(b.what, { ref: 'bound', name: a.as })) return null;
  if (!same(b.to, { zone: 'battlefield', controller: 'owner' })) return null;
  const kind = f.anyOf[0]!;
  bind(st, a.as, { nouns: [...K.nounsOf(kind), 'card'], plural: true });
  const card = K.np({ ...kind, isCard: true, zone: 'hand' }, st, { det: 'a', noZone: true });
  return { clauses: [plain(`${alt('each opponent', 'each other player')} may put ${card} from their hand onto the battlefield`, { standalone: true })], consumed: 2 };
}

/** The folds of p2-group-actions-2 (render/fold.ts#foldAt). */
export function foldP2GroupActions2(list: EffectStep[], i: number, st: RenderState): Folded | null {
  return eachOpponentMayPutOneFromHand(list, i, st);
}

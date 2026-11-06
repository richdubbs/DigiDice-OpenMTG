/**
 * Commander lane edh-next, round edh-next-1: the fold of the steps its templates build (render/fold.ts#foldAt tries `foldEdhNext1` after the other slices' own folds). A fold
 * applies only when every part is exactly what the idiom says.
 */
import type { EffectStep } from '../types/ability';
import { plain } from './clause';
import type { Folded } from './fold';
import { K } from './kernel';
import type { RenderState } from './state';
import { bind } from './steps-util';

const same = (a: unknown, b: unknown): boolean => JSON.stringify(a) === JSON.stringify(b);

/**
 * "At the beginning of each player's upkeep, that player may put an artifact, creature, or land card from their hand onto the battlefield." (Braids, Conjurer Adept; CR 608.2d,
 * 110.2a, 400.7): the one player the sentence names (not you, not a group) chooses up to one of the described cards in their own hand, which is put onto the battlefield under
 * that player's control (its owner's: the card comes from their hand). Exactly the two steps of template eff.edhn1.thatPlayer.may.put.fromHand.bf.
 */
function playerMayPutOneFromHand(list: EffectStep[], i: number, st: RenderState): Folded | null {
  const a = list[i];
  const b = list[i + 1];
  if (a?.op !== 'chooseObjects' || a.guard !== undefined || a.random !== undefined || a.groupLimit !== undefined || a.startingWith !== undefined || a.perPlayer !== undefined || a.min !== 0 || a.max !== 1) return null;
  if (a.who.ref !== 'event' && a.who.ref !== 'target' && a.who.ref !== 'controllerOf' && a.who.ref !== 'ownerOf') return null; // one player an earlier clause names, never a group or you
  if (a.from.ref !== 'each') return null;
  const f = a.from.filter;
  if (f.anyOf?.length !== 1 || f.zone !== 'hand' || !same(f.owner, a.who) || f.isCard !== true || Object.keys(f).some((k) => !['anyOf', 'zone', 'owner', 'isCard'].includes(k))) return null;
  if (b?.op !== 'move' || b.guard !== undefined || b.as !== undefined || b.until !== undefined || b.link !== undefined || !same(b.what, { ref: 'bound', name: a.as })) return null;
  if (!same(b.to, { zone: 'battlefield', controller: 'owner' })) return null;
  const kind = f.anyOf[0]!;
  bind(st, a.as, { nouns: [...K.nounsOf(kind), 'card'], plural: true });
  const card = K.np({ ...kind, isCard: true, zone: 'hand' }, st, { det: 'a', noZone: true });
  return { clauses: [plain(`${K.player(a.who, st, 'subject').text} may put ${card} from their hand onto the battlefield`, { standalone: true, commaThen: true /* edh-next-142 (CR 608.2c, 608.2d; Pendant of Prosperity): "~'s owner draws a card, then that player may put ...": after a plain instruction also ", then" (Clause.commaThen) */ })], consumed: 2 };
}

/** The folds of edh-next-1 (render/fold.ts#foldAt). */
export function foldEdhNext1(list: EffectStep[], i: number, st: RenderState): Folded | null {
  return playerMayPutOneFromHand(list, i, st);
}

/**
 * Commander lane edh-c, round edh-c-105: the fold of the steps its templates build (render/fold.ts#foldAt tries `foldEdhV105` after the other slices' own folds). A fold applies
 * only when every part is exactly what the idiom says. (No value is imported from fold.ts: it imports this file.)
 */
import type { EffectStep } from '../types/ability';
import { plain } from './clause';
import type { Folded } from './fold';
import { K } from './kernel';
import type { RenderState } from './state';
import { bind } from './steps-util';

const same = (a: unknown, b: unknown): boolean => JSON.stringify(a) === JSON.stringify(b);

/**
 * "Each player exiles two cards from their hand." (Mind Swords; CR 101.4, 406.1, 608.2d, 400.3): every player chooses that many cards in their own hand, all exiled together.
 * Exactly the two steps of template eff.edhv105.eachPlayer.exiles.nCardsFromHand.
 */
function eachPlayerExilesFromHand(list: EffectStep[], i: number, st: RenderState): Folded | null {
  const a = list[i];
  const b = list[i + 1];
  if (a?.op !== 'chooseObjects' || a.guard !== undefined || a.random !== undefined || a.groupLimit !== undefined || a.startingWith !== undefined || a.link !== undefined || a.distinct !== undefined) return null;
  if (a.who.ref !== 'iterating' || !same(a.perPlayer, { ref: 'each', who: 'player' }) || a.from.ref !== 'each' || a.min === 0 || a.min === 'any' || !same(a.min, a.max)) return null;
  if (!same(a.from.filter, { zone: 'hand', owner: { ref: 'iterating' }, isCard: true })) return null;
  if (b?.op !== 'move' || b.guard !== undefined || b.as !== undefined || b.until !== undefined || b.link !== undefined || !same(b.what, { ref: 'bound', name: a.as }) || !same(b.to, { zone: 'exile' })) return null;
  bind(st, a.as, { nouns: ['card'], plural: true });
  return { clauses: [plain(`each player exiles ${K.qty(a.min, st)} cards from their hand`, { standalone: true })], consumed: 2 };
}

/** The folds of edh-c-105 (render/fold.ts#foldAt). */
export function foldEdhV105(list: EffectStep[], i: number, st: RenderState): Folded | null {
  return eachPlayerExilesFromHand(list, i, st);
}

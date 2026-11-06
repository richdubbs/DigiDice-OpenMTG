/**
 * edh-d-19 (Commander coordinator D, lane vote): the folds of its templates (parser/templates/zz-cloud/edh-d-19.json), called from render/fold.ts#foldAt. Each applies only when
 * every part is exactly what the idiom says.
 *
 * `eachPlayerReturnsUpToFromGraveyard` (CR 101.4, 608.2d, 400.7, 701.9a; Sail into the West): "Each player returns up to two cards from their graveyard to their hand.": each player
 * in APNAP order chooses between none and that many cards in their own graveyard, then every card chosen is put into its owner's hand. Exactly the two steps of template
 * eff.edhd19.eachPlayer.returnsUpTo.graveyard.hand.
 */
import type { EffectStep } from '../types/ability';
import { plain } from './clause';
import type { Folded } from './fold';
import type { RenderState } from './state';
import { bind } from './steps-util';
import { numWord } from './text';

const same = (a: unknown, b: unknown): boolean => JSON.stringify(a) === JSON.stringify(b);
const ITERATING = { ref: 'iterating' };

function eachPlayerReturnsUpToFromGraveyard(list: EffectStep[], i: number, st: RenderState): Folded | null {
  const a = list[i];
  const b = list[i + 1];
  if (a?.op !== 'chooseObjects' || a.guard !== undefined || a.random !== undefined || a.groupLimit !== undefined || a.startingWith !== undefined || a.eachCardType !== undefined || a.link !== undefined) return null;
  if (a.min !== 0 || typeof a.max !== 'number' || a.max < 2 || a.as === undefined || a.distinct !== undefined || a.damageSource !== undefined) return null;
  if (!same(a.who, ITERATING) || !same(a.perPlayer, { ref: 'each', who: 'player' }) || a.from.ref !== 'each') return null;
  if (!same(a.from.filter, { zone: 'graveyard', owner: ITERATING, isCard: true })) return null;
  if (b?.op !== 'move' || b.guard !== undefined || b.as !== undefined || b.until !== undefined || b.link !== undefined || !same(b.what, { ref: 'bound', name: a.as }) || !same(b.to, { zone: 'hand' })) return null;
  if (list.slice(i + 2).some((x) => JSON.stringify(x).includes(`"${a.as}"`))) return null;
  bind(st, a.as, { nouns: ['card'], plural: true });
  return { clauses: [plain(`each player returns up to ${numWord(a.max)} cards from their graveyard to their hand`)], consumed: 2 };
}

export function foldEdhD19(list: EffectStep[], i: number, st: RenderState): Folded | null {
  return eachPlayerReturnsUpToFromGraveyard(list, i, st);
}

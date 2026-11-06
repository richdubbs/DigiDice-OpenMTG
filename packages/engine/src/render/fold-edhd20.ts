/**
 * edh-d-20 (Commander coordinator D, lane random): the folds of its templates (parser/templates/zz-cloud/edh-d-20.json), called from render/fold.ts#foldAt. Each applies only when every part
 * is exactly what the idiom says.
 *
 * `flipForEachOpponent` (CR 705.1-705.2, 608.2f; Mutalith Vortex Beast, eff.edhd20.flipCoin.forEachOpponentYouHave, eff.edhd20.forEachFlip.win/lose): "Flip a coin for each opponent you
 * have. For each flip you win, draw a card. For each flip you lose, ~ deals 3 damage to that player.": one flip by you for each opponent, called, the opponent of the iteration being "that
 * player" in the results. A `forEach` over the opponents whose one instruction is your flip (a win branch, a lose branch, or both); nothing else in the loop.
 */
import type { EffectStep } from '../types/ability';
import { acting } from './clause';
import type { Folded } from './fold';
import { K } from './kernel';
import { bind } from './steps-util';
import type { RenderState } from './state';

const same = (a: unknown, b: unknown): boolean => JSON.stringify(a) === JSON.stringify(b);

function flipForEachOpponent(list: EffectStep[], i: number, st: RenderState): Folded | null {
  const a = list[i];
  if (a?.op !== 'forEach' || a.guard !== undefined || a.gather !== undefined || a.as !== 'each' || !same(a.over, { ref: 'each', who: 'opponent' }) || a.do.length !== 1) return null;
  const f = a.do[0]!;
  if (f.op !== 'flipCoin' || f.guard !== undefined || !same(f.who, { ref: 'you' }) || f.count !== undefined || f.untilLose !== undefined || f.called !== undefined || f.as !== undefined) return null;
  const hasWin = f.onWin !== undefined && f.onWin.length > 0;
  const hasLose = f.onLose !== undefined && f.onLose.length > 0;
  if (!hasWin && !hasLose) return null;
  bind(st, a.as, { nouns: ['player', 'opponent'], plural: false, player: true, iterates: 'opponent' });
  const win = hasWin ? `. for each flip you win, ${K.steps(f.onWin!, st)}` : '';
  const lose = hasLose ? `. for each flip you lose, ${K.steps(f.onLose!, st)}` : '';
  const text = `flip a coin for each opponent you have${win}${lose}`;
  return { clauses: [acting('you', text, text, { standalone: true })], consumed: 1 };
}

/**
 * `flipForEachDestroyTails` (CR 705.1-705.2, 701.8a, 608.2f; Rakdos, the Showstopper, eff.edhd20.flipCoin.forEach.filter, eff.edhd20.destroyEach.creature.whoseCoinTails): "Flip a coin for each
 * creature that isn't a Demon, Devil, or Imp. Destroy each creature whose coin comes up tails.": one flip by you for each creature of the description, and the creature whose flip you lose is
 * destroyed. A `forEach` over a group of creatures whose one instruction is your flip, with one tails branch (an uncalled flip, nobody wins or loses it) that remembers the creature of the iteration.
 */
function flipForEachDestroyTails(list: EffectStep[], i: number, st: RenderState): Folded | null {
  const a = list[i];
  const z = list[i + 1];
  if (a?.op !== 'forEach' || a.guard !== undefined || a.gather !== 'tails' || a.as !== 'each' || a.over.ref !== 'each' || !('filter' in a.over) || a.do.length !== 1) return null;
  if (z?.op !== 'destroy' || z.guard !== undefined || z.regeneration !== undefined || z.boundTo !== undefined || !same(z.what, { ref: 'bound', name: 'tails' })) return null;
  const f = a.do[0]!;
  if (f.op !== 'flipCoin' || f.guard !== undefined || !same(f.who, { ref: 'you' }) || f.count !== undefined || f.untilLose !== undefined || f.called !== undefined || f.as !== undefined || f.onWin !== undefined || f.onLose !== undefined) return null;
  const c = f.onTails?.length === 1 ? f.onTails[0]! : undefined;
  if (c?.op !== 'chooseObjects' || c.guard !== undefined || c.random !== undefined || c.as !== 'tails' || c.min !== 1 || c.max !== 1 || !same(c.who, { ref: 'you' }) || !same(c.from, { ref: 'bound', name: 'each' })) return null;
  const nouns = K.nounsOf(a.over.filter);
  if (!nouns.includes('creature') || a.over.filter.types?.length !== 1 || a.over.filter.types[0] !== 'Creature') return null;
  const group = K.np(a.over.filter, st, { det: 'none' });
  bind(st, a.as, { nouns, plural: false, iterates: nouns });
  const text = `flip a coin for each ${group}. destroy each creature whose coin comes up tails`;
  return { clauses: [acting('you', text, text, { standalone: true })], consumed: 2 };
}

export function foldEdhD20(list: EffectStep[], i: number, st: RenderState): Folded | null {
  return flipForEachOpponent(list, i, st) ?? flipForEachDestroyTails(list, i, st);
}

/**
 * edh-b-12 (Commander lane edh-b, EDHREC ranks 8,001-9,000, fifth pass): the folds of its templates (parser/templates/zz-cloud/edh-b-12.json), called from
 * render/fold.ts#foldAt.
 *
 * `millThenOpponentChoosesReturn` (CR 701.17a, 608.2d, 400.3; Tasigur, the Golden Fang, eff.edhb12.mill.thenReturnOpponentsChoice): "Mill two cards, then return a nonland card of an
 * opponent's choice from your graveyard to your hand.": your mill, then an opponent's choice of one card of your graveyard and its return to your hand. Only that exact shape.
 */
import type { EffectStep, ObjectFilter } from '../types/ability';
import { plain } from './clause';
import type { Folded } from './fold';
import { K } from './kernel';
import type { RenderState } from './state';

const json = JSON.stringify;

function millThenOpponentChoosesReturn(list: EffectStep[], i: number, st: RenderState): Folded | null {
  const [mill, pick, move] = [list[i], list[i + 1], list[i + 2]];
  if (mill?.op !== 'mill' || pick?.op !== 'chooseObjects' || move?.op !== 'move' || pick.as === undefined) return null;
  if (json(mill.who) !== json({ ref: 'you' }) || mill.guard !== undefined || pick.guard !== undefined || move.guard !== undefined || move.as !== undefined || move.until !== undefined) return null;
  if (json(pick.who) !== json({ ref: 'anOpponent' }) || pick.min !== 1 || pick.max !== 1 || pick.random !== undefined || pick.groupLimit !== undefined || pick.perPlayer !== undefined || pick.startingWith !== undefined) return null;
  if (pick.from.ref !== 'each' || !('filter' in pick.from)) return null;
  const { zone, owner, isCard, ...kind } = pick.from.filter as ObjectFilter;
  if (zone !== 'graveyard' || owner !== 'you' || isCard !== true) return null;
  if (json(move.what) !== json({ ref: 'bound', name: pick.as }) || json(move.to) !== json({ zone: 'hand' })) return null;
  const head = K.steps([mill], st).replace(/\.$/, '');
  const card = K.np({ ...kind, isCard: true, zone: 'graveyard' }, st, { det: 'a', noZone: true });
  return { clauses: [plain(`${head}, then return ${card} of an opponent's choice from your graveyard to your hand`, { standalone: true })], consumed: 3 };
}

export function foldEdhB12(list: EffectStep[], i: number, st: RenderState): Folded | null {
  return millThenOpponentChoosesReturn(list, i, st);
}

/**
 * edh-players-7 (Commander lane edh-players): the folds of its templates (parser/templates/zz-cloud/edh-players-7.json), called from render/fold.ts#foldAt.
 *
 * `forEachChosenPayLifeOrPutTop` (CR 118.12, 119.4, 608.2c; Sylvan Library; eff.edhp7.forEach.chosen.payLifeOrPutTop): "For each of those cards, pay 4 life or put the card
 * on top of your library.": for each card an earlier instruction chose (`chosenDrawn`, the cards chosen from the hand cards drawn this turn), its controller pays life or, if they don't, puts that card on top of its owner's library. Only
 * that exact shape: one step over the bound `chosen` set, one `pay` of life by "you" whose `else` moves the iterated card to the top of the library.
 */
import type { EffectStep } from '../types/ability';
import { plain } from './clause';
import type { Folded } from './fold';
import { K } from './kernel';
import type { RenderState } from './state';

function forEachChosenPayLifeOrPutTop(list: EffectStep[], i: number, st: RenderState): Folded | null {
  const f = list[i];
  if (f?.op !== 'forEach' || f.guard !== undefined || f.gather !== undefined || f.over.ref !== 'bound' || f.over.name !== 'chosenDrawn' || f.do.length !== 1) return null;
  const pay = f.do[0];
  if (pay?.op !== 'pay' || pay.guard !== undefined || pay.as !== undefined || pay.who.ref !== 'you' || pay.then !== undefined || pay.times !== undefined || pay.upTo !== undefined || pay.mandatory !== undefined) return null;
  const costs = typeof pay.cost === 'object' ? pay.cost.other : undefined;
  if (costs?.length !== 1 || costs[0]!.kind !== 'payLife' || Object.keys(pay.cost).some((k) => k !== 'other')) return null;
  const move = pay.else?.length === 1 ? pay.else[0] : undefined;
  if (move?.op !== 'move' || move.guard !== undefined || move.as !== undefined || JSON.stringify(move.what) !== JSON.stringify({ ref: 'bound', name: f.as })
    || JSON.stringify(move.to) !== JSON.stringify({ zone: 'library', position: 'top' })) return null;
  const amount = K.qty(costs[0]!.amount as never, st);
  return { clauses: [plain(`for each of those cards, pay ${amount} life or put the card on top of your library`, { standalone: true })], consumed: 1 };
}

export function foldEdhP7(list: EffectStep[], i: number, st: RenderState): Folded | null {
  return forEachChosenPayLifeOrPutTop(list, i, st);
}

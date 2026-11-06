/**
 * edh-next-131 (CR 101.4, 608.2d, 701.9a, 701.21a; Eumidian Wastewaker): the clause of the `discardOrSacrifice` step, "you and defending player each discard a card or sacrifice a permanent".
 * Only that pair of players and any permanent; the cards it put into a graveyard are "put into a graveyard this way" afterwards (render/fold-edhn131.ts reads them in the draw that counts them).
 */
import { plain, type Clause } from './clause';
import type { EffectStep } from '../types/ability';
import type { RenderState } from './state';
import { NoRenderer } from './text';

export const CLAUSES_EDHN131 = {
  discardOrSacrifice: (s: Extract<EffectStep, { op: 'discardOrSacrifice' }>, _st: RenderState): Clause => {
    if (JSON.stringify(s.players) !== JSON.stringify([{ ref: 'you' }, { ref: 'defending' }]) || Object.keys(s.filter).length !== 0) throw new NoRenderer('a discard-or-sacrifice of other players than you and defending player, or of other permanents');
    return plain('you and defending player each discard 1 card or sacrifice 1 permanent');
  },
};

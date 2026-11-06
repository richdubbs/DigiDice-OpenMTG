/**
 * edh-zones-5 (CR 400.7, 608.2c, 608.2h; Tergrid, God of Fright): `thatCardFromGraveyard`, "that card from a graveyard" in an `Objs` position: the card an event or an
 * earlier instruction named ("that card" is the usual anaphor), but only while it is in a graveyard. A card that has left the graveyard in the meantime is a new object
 * that the instruction can't find there (CR 400.7), so nothing is put onto the battlefield. The value is the set of that card in a graveyard:
 *   `{ ref: 'each', filter: { is: <that card>, zone: 'graveyard', isCard: true } }`.
 */
import { P, anaphorObj, phraseAt, type Alt, type HoleFn } from './core';

const W_THAT_CARD_FROM_A_GRAVEYARD = P('that card from a graveyard');

export const thatCardFromGraveyard: HoleFn = (ctx, pos): Alt[] => {
  const e = phraseAt(ctx, pos, W_THAT_CARD_FROM_A_GRAVEYARD);
  if (e < 0) return [];
  const that = anaphorObj({ sort: 'object', number: 'singular', head: 'card', text: 'that card' });
  return [{ end: e, value: { ref: 'each', filter: { is: that, zone: 'graveyard', isCard: true } } }];
};

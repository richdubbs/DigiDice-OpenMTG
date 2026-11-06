/**
 * edh-next-108 (CR 608.2c, 406.1; Hellcarver Demon, Kefka): "cards exiled this way" with no article as the group the `Them` hole names in "You may cast any number of spells from among
 * cards exiled this way without paying their mana costs": the cards an earlier exile of the ability exiled (the participle `exiled` of lower/mentions.ts, the same anaphor as "the
 * exiled cards"). Unresolved (no earlier exile in the ability), the sentence stays manual.
 */
import type { Alt, HoleCtx } from './core';
import { P, anaphorObj, phraseAt } from './core';

const W_CARDS_EXILED_THIS_WAY = P('cards exiled this way');

export function bareCardsExiledThisWay(ctx: HoleCtx, pos: number): Alt[] {
  const e = phraseAt(ctx, pos, W_CARDS_EXILED_THIS_WAY);
  if (e < 0) return [];
  return [{ end: e, value: anaphorObj({ sort: 'set', number: 'plural', head: 'card', participle: 'exiled', text: 'cards exiled this way' }) }];
}

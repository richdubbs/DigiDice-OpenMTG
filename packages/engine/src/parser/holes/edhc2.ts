/**
 * edh-cast-2 (CR 608.2c, 400.7; ported from the stopped round p2-exile-play-2, narrowed): "the nonland cards exiled this way" as the group the `Them` hole names in
 * the templates that pick among a group of exiled cards ("You may cast any number of spells from among the nonland cards exiled this way without paying their mana
 * costs.", after "each player exiles cards from the top of their library until they exile a nonland card"): the cards an earlier exile of the ability exiled (the
 * participle `exiled` of lower/mentions.ts, the same anaphor as "the exiled cards"), of that description only: `{ref:'each', filter:{is:<the group>, ...description,
 * zone:'exile'}}` (the group is in exile; a set's filter with no zone looks at the battlefield), the description kept, never dropped. One card-type word or
 * "nonland" only; unresolved, the sentence stays manual.
 */
import type { ObjectFilter } from '../../types/ability';
import type { Alt, HoleCtx } from './core';
import { P, anaphorObj, phraseAt } from './core';

const W_THE = P('the');
const W_CARDS_EXILED_THIS_WAY = P('cards exiled this way');

export function typedCardsExiledThisWay(ctx: HoleCtx, pos: number): Alt[] {
  const at = phraseAt(ctx, pos, W_THE);
  const t = at >= 0 ? ctx.toks[at] : undefined;
  if (t === undefined || t.kind !== 'WORD') return [];
  let filter: ObjectFilter | null = null;
  if (t.norm === 'nonland') filter = { notTypes: ['Land'] };
  else {
    const ty = ctx.vocab.types.get(t.norm);
    if (ty !== undefined && !ty.plural) filter = { types: [ty.name] } as ObjectFilter;
  }
  const e = filter === null ? -1 : phraseAt(ctx, at + 1, W_CARDS_EXILED_THIS_WAY);
  if (e < 0) return [];
  const group = anaphorObj({ sort: 'set', number: 'plural', head: 'card', participle: 'exiled', text: 'the exiled cards' });
  return [{ end: e, value: { ref: 'each', filter: { is: group, ...filter, zone: 'exile' } } }];
}

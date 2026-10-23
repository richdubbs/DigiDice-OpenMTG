/**
 * Cloud r4-dig (Standard round 4): small hole grammars of its templates (parser/templates/zz-cloud/r4-dig.json).
 *
 * `CardsDesc`: a plural card description with no count of its own, the cards a dig chooses among ("You may reveal up to two creature cards from among them",
 * "Put up to two noncreature, nonland permanent cards with mana value 3 or less from among them onto the battlefield"; CR 608.2c-d): the plural of `DiscardDesc`
 * (parser/holes/cost.ts#discardDesc), its value the filter of the cards described (no `isCard`, no `zone`: the template's pool says where the cards are). A
 * description with a flag (a property of the set, "with different names") is no reading.
 */
import type { ObjectFilter } from '../../types/ability';
import type { Alt, HoleFn } from './core';
import { P, phraseAt } from './core';
import { discardDesc } from './cost';
import { npAlts } from './filter';

const W_LEGENDARY_OR = [P('legendary and/or'), P('legendary or')];

export const cardsDesc: HoleFn = (ctx, pos) => {
  const out: Alt[] = [];
  for (const n of npAlts(ctx, pos)) {
    if (n.number !== 'plural' || n.head !== 'card' || n.filter.zone !== undefined) continue;
    if (n.flags.some((f) => f !== 'zone-unstated')) continue;
    const { isCard: _isCard, ...filter } = n.filter as ObjectFilter;
    out.push({ end: n.end, value: filter, ...(n.weak ? { weak: n.weak } : {}) });
  }
  // std-rj (CR 205.4a, 205.2a; Nashi): "legendary and/or enchantment cards": the cards that are legendary, or enchantments (a supertype and a card type are both properties
  // an object may have alone; "and/or" and "or" are the same set). Only a card type or a subtype beside the supertype, nothing else in the description
  for (const w of W_LEGENDARY_OR) {
    const e = phraseAt(ctx, pos, w);
    if (e < 0) continue;
    for (const n of npAlts(ctx, e)) {
      if (n.number !== 'plural' || n.head !== 'card' || n.filter.zone !== undefined || n.flags.some((f) => f !== 'zone-unstated')) continue;
      const { isCard: _isCard, ...filter } = n.filter as ObjectFilter;
      const keys = Object.keys(filter);
      if (keys.length !== 1 || (keys[0] !== 'types' && keys[0] !== 'subtypes')) continue;
      out.push({ end: n.end, value: { anyOf: [{ supertypes: ['Legendary'] }, filter] }, ...(n.weak ? { weak: n.weak } : {}) });
    }
  }
  return out;
};

const weaker = (alts: Alt[]): Alt[] => alts.map((a) => ({ ...a, weak: (a.weak ?? 0) + 1 }));

const W_OR = P('or');
const W_CARD = P('card');

/**
 * `SearchDesc`: the card a search of the library is for, with its article, one unspecific word lower (`weak`): `DiscardDesc`'s description,
 * "a basic land card or a Desert card" (`anyOf`; "a creature or land card" is r3-refs' eff.r3refs.search.orCard.reveal). The search templates that read it end at "reveal it" and compose with the
 * instructions after them ("put it into your hand, then shuffle"); every sentence a whole-sentence search template reads keeps that reading (it ranks higher), so
 * these readings only apply where no other template reads the sentence.
 */
export const searchDesc: HoleFn = (ctx, pos) => {
  const out: Alt[] = [...discardDesc(ctx, pos)];
  const art = ctx.toks[pos]?.norm;
  if (art === 'a' || art === 'an') {
    for (const f of ctx.call('Filter', pos + 1)) {
      // "a basic land card or a Desert card"
      const c = phraseAt(ctx, f.end, W_CARD);
      const o = c >= 0 ? phraseAt(ctx, c, W_OR) : -1;
      const art2 = o >= 0 ? ctx.toks[o]?.norm : undefined;
      if (art2 !== 'a' && art2 !== 'an') continue;
      for (const g of ctx.call('Filter', o + 1)) {
        const e = phraseAt(ctx, g.end, W_CARD);
        if (e >= 0) out.push({ end: e, value: { anyOf: [f.value as ObjectFilter, g.value as ObjectFilter] } });
      }
    }
  }
  return weaker(out);
};

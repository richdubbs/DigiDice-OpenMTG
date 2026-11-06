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
const withoutIsCard = (f: ObjectFilter): ObjectFilter => { const { isCard: _isCard, ...rest } = f; return rest; };
const W_CARD = P('card');
const W_COMMA = P(','); // edh-zones-26
const W_COMMA_OR = P(', or'); // edh-zones-26

/**
 * `SearchDesc`: the card a search of the library is for, with its article, one unspecific word lower (`weak`): `DiscardDesc`'s description,
 * "a basic land card or a Desert card" (`anyOf`; "a creature or land card" is r3-refs' eff.r3refs.search.orCard.reveal). The search templates that read it end at "reveal it" and compose with the
 * instructions after them ("put it into your hand, then shuffle"); every sentence a whole-sentence search template reads keeps that reading (it ranks higher), so
 * these readings only apply where no other template reads the sentence.
 */
export const searchDesc: HoleFn = (ctx, pos) => {
  const out: Alt[] = [...discardDesc(ctx, pos)];
  const extra: Alt[] = [];
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
    // edh-zones-4 (CR 608.2c, 701.23a): "an artifact card with a mana ability or a basic land card" (Moonsilver Key): either half is a whole card description with its own
    // qualifiers (a noun phrase of the head "card": "with a mana ability", "with mana value 3 or less"), which `Filter card` above stops short of; a flag (a property of the set) is no reading
    for (const n of npAlts(ctx, pos + 1)) {
      if (n.number !== 'singular' || n.head !== 'card' || n.filter.zone !== undefined || n.flags.some((fl) => fl !== 'zone-unstated')) continue;
      const o = phraseAt(ctx, n.end, W_OR);
      const art2 = o >= 0 ? ctx.toks[o]?.norm : undefined;
      // edh-zones-9 (CR 701.23a; Open the Gates): "a basic land card or Gate card": the article said once, before the first half (the second half is a whole card description with no article)
      if (o >= 0 && art2 !== 'a' && art2 !== 'an') {
        for (const m of npAlts(ctx, o)) {
          if (m.number !== 'singular' || m.head !== 'card' || m.filter.zone !== undefined || m.flags.some((fl) => fl !== 'zone-unstated')) continue;
          const theirs = (f: ObjectFilter): boolean => f.keyword !== undefined || f.notKeyword !== undefined || f.manaValue !== undefined;
          if (!out.some((a) => a.end === m.end) && !theirs(n.filter) && !theirs(m.filter)) extra.push({ end: m.end, value: { anyOf: [withoutIsCard(n.filter), withoutIsCard(m.filter)] }, ...(n.weak + m.weak > 0 ? { weak: n.weak + m.weak } : {}) });
        }
        continue;
      }
      if (art2 !== 'a' && art2 !== 'an') continue;
      for (const m of npAlts(ctx, o + 1)) {
        if (m.number !== 'singular' || m.head !== 'card' || m.filter.zone !== undefined || m.flags.some((fl) => fl !== 'zone-unstated')) continue;
        // not weakened: the first reading above stops at the qualifier ("zone-unstated" notes), so this one is the only whole reading, and the wording is as specific as a name.
        // A half with a keyword or a mana value is the whole-sentence templates' (eff.t31.search.orCardWithKeyword / orMvAtMost read "... or a card with flash", "... or a creature
        // card with mana value 1 or less"): leaving those sentences to them keeps their readings (equal priority would make the sentence ambiguous, G5)
        const theirs = (f: ObjectFilter): boolean => f.keyword !== undefined || f.notKeyword !== undefined || f.manaValue !== undefined;
        if (!out.some((a) => a.end === m.end) && !theirs(n.filter) && !theirs(m.filter)) extra.push({ end: m.end, value: { anyOf: [withoutIsCard(n.filter), withoutIsCard(m.filter)] }, ...(n.weak + m.weak > 0 ? { weak: n.weak + m.weak } : {}) });
      }
    }
  }
  // edh-zones-26 (CR 701.23a, 608.2c; Search for Glory): a list of three, each half a whole card description with its own article, "a snow permanent card, a legendary card, or a Saga card":
  // one card that fits any of them (a bare supertype is a description only with its noun, so the halves are read as noun phrases of the head "card", as above)
  if (art === 'a' || art === 'an') {
    const half = (p: number, art2: boolean) => (art2 ? ctx.toks[p]?.norm === 'a' || ctx.toks[p]?.norm === 'an' : true)
      ? npAlts(ctx, art2 ? p + 1 : p).filter((n) => n.number === 'singular' && n.head === 'card' && n.filter.zone === undefined && n.flags.every((fl) => fl === 'zone-unstated') && n.filter.keyword === undefined && n.filter.notKeyword === undefined && n.filter.manaValue === undefined)
      : [];
    for (const a of half(pos, true)) {
      const c1 = phraseAt(ctx, a.end, W_COMMA);
      if (c1 < 0) continue;
      for (const b of half(c1, true)) {
        const c2 = phraseAt(ctx, b.end, W_COMMA_OR);
        if (c2 < 0) continue;
        for (const c of half(c2, true)) extra.push({ end: c.end, value: { anyOf: [withoutIsCard(a.filter), withoutIsCard(b.filter), withoutIsCard(c.filter)] }, ...(a.weak + b.weak + c.weak > 0 ? { weak: a.weak + b.weak + c.weak } : {}) });
      }
    }
  }
  return [...weaker(out), ...extra];
};

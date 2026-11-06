/**
 * edh-b-1 ADDITION: the `ListedCard` hole, a card description with its article whose last item of a list is a legendary one: "a Knight, Aura, Equipment, or legendary artifact card"
 * (CR 205.4a, 205.2a, 205.3m, 608.2c; Acclaimed Contender). The value is the filter without `isCard` (as DiscardDesc's): any of the listed card types or subtypes, or a legendary card of
 * the last one's type. The `Filter` hole reads lists of types and subtypes but a supertype inside the list is none of its readings; a description with no such item is the
 * `Filter` hole's (a template that reads "{f:Filter} card" owns it), so a template using this hole never competes with theirs.
 */
import type { ObjectFilter } from '../../types/ability';
import type { Alt, HoleFn } from './core';
import { P, multiAt, phraseAt } from './core';

const W_OR_LEGENDARY = [P(', or legendary'), P('or legendary')];
const W_CARD = P('card');

export const listedCard: HoleFn = (ctx, pos) => {
  const art = ctx.toks[pos]?.norm;
  if (art !== 'a' && art !== 'an') return [];
  const out: Alt[] = [];
  for (const f of ctx.call('Filter', pos + 1)) {
    const fv = f.value as ObjectFilter;
    if (fv.anyOf !== undefined || (fv.types === undefined && fv.subtypes === undefined)) continue;
    for (const w of W_OR_LEGENDARY) {
      const e = phraseAt(ctx, f.end, w);
      if (e < 0) continue;
      for (const g of ctx.call('Filter', e)) {
        const gv = g.value as ObjectFilter;
        const end = phraseAt(ctx, g.end, W_CARD);
        if (end < 0 || Object.keys(gv).some((k) => k !== 'types' && k !== 'subtypes')) continue;
        out.push({ end, value: { anyOf: [fv, { supertypes: ['Legendary'], ...gv }] } });
      }
    }
  }
  return out;
};

const W_LIST_SEPS = [P(', and'), P(','), P('and')];

/**
 * edh-b-1 ADDITION: the `SubtypeList` hole, creature (or other) subtypes said as a list with one article: "a Cleric, Rogue, Warrior, and Wizard" (CR 205.3m, 205.1b; Burakos, Party Leader):
 * two to five singular subtypes, value the names. The `Subtypes` hole is the types of one object said together ("a Horror Wizard"), a list is another set of words: an object that is
 * every one of them, which "is also" adds.
 */
export const subtypeList: HoleFn = (ctx, pos) => {
  const art = ctx.toks[pos]?.norm;
  if (art !== 'a' && art !== 'an') return [];
  const out: Alt[] = [];
  const walk = (p: number, acc: string[]): void => {
    for (const m of multiAt(ctx, p, ctx.vocab.subtypes)) {
      if (m.entry.plural || acc.includes(m.entry.name)) continue;
      const names = [...acc, m.entry.name];
      if (names.length >= 2) out.push({ end: m.end, value: names });
      if (names.length >= 5) continue;
      for (const sep of W_LIST_SEPS) {
        const e = phraseAt(ctx, m.end, sep);
        if (e >= 0) walk(e, names);
      }
    }
  };
  walk(pos + 1, []);
  return out;
};

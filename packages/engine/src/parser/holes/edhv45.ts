/**
 * edh-c-45 (CR 702.11d, 702.11b, 205.2a; Nevinyrral, Urborg Tyrant): `HexFromTypes`, a printed "hexproof from artifacts, creatures, and enchantments" and nothing else: hexproof
 * from two or more card types in a comma list ("A and B", "A, B, and C"), each type a plural card-type word. It reads as one keyword ability for each type (CR 702.11b: several
 * instances of hexproof with a quality each, "redundantPerParam"); the Abilities list of misc.ts reads "from <quality> and from <quality>" for colors and the like.
 *   value `[<hexproof from <type> keyword ability>...]`, each with its own words (`text`) for the render gate (parser/lower/ability.ts#andOrItems).
 * A word in the list that is not a plural card type parses to nothing (fail closed); a single type is the plain keyword.
 */
import { P, phraseAt, type HoleFn } from './core';

const W_HEXPROOF_FROM = P('hexproof from');
const W_AND = P('and');
const W_COMMA_AND = P(', and');
const W_COMMA = P(',');

export const hexFromTypes: HoleFn = (ctx, pos) => {
  const start = phraseAt(ctx, pos, W_HEXPROOF_FROM);
  if (start < 0) return [];
  const names: string[] = [];
  const words: string[] = [];
  const out: { end: number; value: unknown }[] = [];
  let p = start;
  for (;;) {
    const t = ctx.toks[p];
    const ty = t !== undefined && t.kind === 'WORD' ? ctx.vocab.types.get(t.norm) : undefined;
    if (ty === undefined || !ty.plural || names.includes(ty.name)) break;
    names.push(ty.name);
    words.push(t!.norm);
    p++;
    if (names.length >= 2) out.push({ end: p, value: names.map((n, i) => ({ kind: 'keyword', keyword: 'hexproof', quality: `type:${n}`, text: `hexproof from ${words[i]!}` })) });
    // the next item follows ", and", "," or (for two items) "and"
    const next = phraseAt(ctx, p, W_COMMA_AND) >= 0 ? phraseAt(ctx, p, W_COMMA_AND) : phraseAt(ctx, p, W_COMMA) >= 0 ? phraseAt(ctx, p, W_COMMA) : phraseAt(ctx, p, W_AND);
    if (next < 0) break;
    p = next;
  }
  // only the whole list counts: a prefix that stops before a following item would leave the rest of the line unread (the chart takes the longest that ends where the template does)
  return out;
};

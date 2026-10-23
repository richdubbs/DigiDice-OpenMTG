/**
 * A quoted ability inside an ability (FXC, audit m2): a granted ability ("Equipped creature has \"Whenever this creature deals combat damage ...\""), a
 * token's ability, an emblem's ability.
 *
 * Inside the quotes, the object the ability belongs to is the object that HAS the quoted ability, not the card that prints it (CR 113.7a: the source of an
 * ability is the object it's on; CR 607 does not link the two). The renderer writes that object as "~" like any self reference, and the display replaces
 * "~" with the card's name, so "Whenever Vibranium Strike Gauntlets deals combat damage" was printed for the equipped creature's ability. Here the quoted
 * text's self references become "this <noun>" (the Oracle wording since 2024): the render gate reads "this <noun>" and the card's name both as "~"
 * (render/equivalence.ts SELF_NOUNS), so only the display changes.
 */
import type { AbilityDef, TokenDef } from '../types/ability';
import { K } from './kernel';
import { alt, hoistFinalPeriod, mapEnds } from './text';
import { nestedState, type RenderState } from './state';

/**
 * The quoted text of `a` for an object that `noun` names ("creature", "token", "land"): self references read "this <noun>".
 *
 * T55 (CR 111.4, 113.7a): with `token`, the quoted ability is one of that token's: the words that depend on what the object is (an Equipment token's "equipped
 * creature", `RenderContext.selfTypes`) read its types and subtypes, and a token with a name of its own is called by it ("Whenever Redwing attacks, surveil 1.").
 */
export function quotedAbility(a: AbilityDef, st: RenderState, noun: string, token?: TokenDef): string {
  const inner = nestedState(st);
  if (token !== undefined) inner.ctx = { ...st.ctx, selfTypes: [...(token.types ?? []), ...(token.subtypes ?? [])] };
  // Oracle says "this token" (the wording of almost every token) or, for a token that has a name of its own, sometimes that name instead: both are the token
  const own = token?.name !== undefined && token.predefined === undefined && !((token.subtypes ?? []).length > 0 && (token.subtypes ?? []).join(' ') === token.name) ? token.name : undefined;
  const self = own === undefined ? `this ${noun}` : alt(`this ${noun}`, own);
  // T55 (CR 207.2c): an ability word inside the quotes is part of the quoted text, "Landfall — Whenever a land you control enters, ..." (no rules meaning)
  const label = a.label !== undefined ? `${a.label} -- ` : '';
  const text = hoistFinalPeriod(K.ability(a, inner).replace(/~/g, self));
  // FAST5 T68 (CR 606.4): the loyalty cost of a granted loyalty ability is written in brackets inside the quotes, "[+1]: Add {R}.", "[-8]: Create ..." (a planeswalker's own
  // loyalty abilities print it bare)
  const bracketed = a.kind === 'activated' && a.cost.loyalty !== undefined ? text.replace(/^([+\-−]?\d+):/, '[$1]:') : text;
  // r3-fx: a quoted ability inside a quoted ability is in single quotes, as Oracle prints it ("This Saga gains "Creatures you control have '{T}: Add {R}.'"")
  const q = st.depth > 0 ? "'" : '"';
  return `${q}${label}${bracketed}${q}`;
}

/**
 * FAST5 T41: a quoted ability that is followed by another item of its list has no full stop of its own: `has "A" and "B."` and, with three or more items,
 * `has reach, "A," and "B."` (the comma of the list goes inside the closing quote, as the American style of Oracle prints it). The last item keeps its
 * period, which closes the sentence of the outer ability.
 */
export function quotedListItem(quoted: string, closing: 'none' | 'comma'): string {
  return mapEnds(quoted, (lit) => lit.replace(/\."$/, closing === 'comma' ? ',"' : '"'));
}

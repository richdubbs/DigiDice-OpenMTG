/**
 * edh-perms-4 ADDITION: the two quoted enchant abilities of an Aura that enchants a card in a graveyard (CR 702.5a, 303.4a, 613.1f; Animate Dead, Dance of the Dead, Necromancy).
 *   - `EnchantGraveyardQuote`: the quoted ability an Aura loses, "enchant <card type> card in a graveyard" (CR 303.4a); value: the filter of that enchant ability, exactly the one the Aura's own
 *     printed line has (the quote is read by the same sub-parser as the printed line), so the layer 6 effect removes that ability and no other.
 *   - `EnchantLinkedQuote`: the quoted ability it gains, "enchant <card type> put onto the battlefield with ~" (CR 607.2a): the permanent the Aura put onto the battlefield with its own ability (the
 *     Aura's link `putWith`, written by the instruction that puts it there). Value: a list of that one enchant keyword ability.
 *   - `EnchantedCard`: "enchanted <card type> card", the card in a graveyard the Aura is attached to (CR 303.4a, 303.4f); value: the reference `{ref:'each', filter}` whose filter names that card by `attachedToSource`.
 * Nothing else parses (fail closed): another zone, a quote of anything but an enchant ability, "put onto the battlefield with" anything but the object itself.
 */
import type { KeywordAbilityDef, ObjectFilter } from '../../types/ability';
import type { Alt, HoleFn } from './core';
import { P, phraseAt } from './core';

/** The link under which the Aura remembers the permanent it put onto the battlefield (CR 607.2a): the parser's instruction that puts it there and the enchant restriction share it. */
export const PUT_WITH_LINK = 'putWith';

const W_PUT_ONTO_WITH = P('put onto the battlefield with');

export const enchantGraveyardQuote: HoleFn = (ctx, pos) => {
  const t = ctx.toks[pos];
  if (t?.kind !== 'QUOTE' || t.sub === undefined || ctx.subParser === undefined) return [];
  const sub = ctx.subParser(t.sub);
  if (sub === null || sub.length !== 1) return [];
  const kw = sub[0] as Partial<KeywordAbilityDef> | undefined;
  const f = kw?.filter;
  if (kw === undefined || kw.kind !== 'keyword' || kw.keyword !== 'enchant' || kw.player !== undefined || f === undefined) return [];
  if (f.zone !== 'graveyard' || f.types?.length !== 1 || f.isCard !== true || Object.keys(f).length !== 3) return [];
  return [{ end: pos + 1, value: f } satisfies Alt];
};

export const enchantLinkedQuote: HoleFn = (ctx, pos) => {
  const t = ctx.toks[pos];
  if (t?.kind !== 'QUOTE' || t.sub === undefined) return [];
  const sub = t.sub;
  if (sub[0]?.kind !== 'WORD' || sub[0].norm !== 'enchant') return [];
  const word = sub[1];
  const entry = word !== undefined && word.kind === 'WORD' ? ctx.vocab.types.get(word.norm) : undefined;
  if (entry === undefined || entry.plural) return [];
  const ty = { name: entry.name, end: 2 };
  // "enchant creature put onto the battlefield with ~" and the full stop that ends the quoted sentence
  const withEnd = phraseAt({ ...ctx, toks: sub }, ty.end, W_PUT_ONTO_WITH);
  // the object itself: "~" (this Aura) or, in a card that becomes an Aura, the name of the card that prints the quote (the grantor token, CR 201.5a)
  const self = withEnd >= 0 ? sub[withEnd] : undefined;
  if (self === undefined || (self.kind !== 'SELF' && self.kind !== 'GRANTOR')) return [];
  const tail = withEnd + 1;
  const rest = sub.slice(tail);
  if (!(rest.length === 0 || (rest.length === 1 && rest[0]!.kind === 'PUNCT' && rest[0]!.norm === '.'))) return [];
  const filter: ObjectFilter = { types: [ty.name as never], is: { ref: 'linked', link: PUT_WITH_LINK } };
  const ability: KeywordAbilityDef = { kind: 'keyword', keyword: 'enchant', filter, text: `Enchant ${ty.name.toLowerCase()} put onto the battlefield with ~` };
  return [{ end: pos + 1, value: [ability] } satisfies Alt];
};

/** "enchanted creature card": the card in a graveyard that the source Aura is attached to (it is attached to a card there, CR 303.4a), as a reference the move instruction can use. */
export const enchantedCard: HoleFn = (ctx, pos) => {
  if (ctx.toks[pos]?.kind !== 'WORD' || ctx.toks[pos]!.norm !== 'enchanted') return [];
  const word = ctx.toks[pos + 1];
  const entry = word !== undefined && word.kind === 'WORD' ? ctx.vocab.types.get(word.norm) : undefined;
  const card = ctx.toks[pos + 2];
  if (entry === undefined || entry.plural || card?.kind !== 'WORD' || card.norm !== 'card') return [];
  const filter: ObjectFilter = { types: [entry.name as never], isCard: true, zone: 'graveyard', attachedToSource: true };
  return [{ end: pos + 3, value: { ref: 'each', filter } } satisfies Alt];
};

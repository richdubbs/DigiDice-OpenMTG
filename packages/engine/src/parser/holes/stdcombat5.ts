/**
 * std-combat-5 ADDITION: the `CreatureTypeChoices` hole, a list of two or more creature type words to choose among ("Human, Merfolk, or Goblin", CR 205.3m), value:
 * the type names (string[], spelled as the lexicon spells them; the choice handler offers exactly those). Oracle's list form
 * only, as std-rD's TypeChoices reads card types: two words joined by "or", or three or more with commas and ", or" before the last; no word twice.
 */
import type { HoleFn } from './core';
import { P, phraseAt } from './core';

export const creatureTypeChoices: HoleFn = (ctx, pos) => {
  const typeAt = (p: number): string | undefined => {
    const t = ctx.toks[p];
    if (t === undefined || t.kind !== 'WORD') return undefined;
    const e = ctx.vocab.subtypes.get(t.norm); // the closed vocabulary (holes/vocab.ts): a singular creature type only
    return e !== undefined && !e.plural && e.cls === 'creature' ? e.name : undefined;
  };
  const first = typeAt(pos);
  if (first === undefined) return [];
  const names = [first];
  let p = pos + 1;
  while (ctx.toks[p]?.norm === ',' && typeAt(p + 1) !== undefined) { names.push(typeAt(p + 1)!); p += 2; }
  const comma = ctx.toks[p]?.norm === ',';
  if (comma !== names.length > 1) return [];
  if (comma) p++;
  if (ctx.toks[p]?.norm !== 'or') return [];
  const last = typeAt(p + 1);
  if (last === undefined) return [];
  names.push(last);
  return new Set(names).size === names.length ? [{ end: p + 2, value: names }] : [];
};

const W_THE_CHOSEN_TYPE = P('the chosen type');

/**
 * std-combat-5 ADDITION: the `ChosenType` hole, "the chosen type" on its own ("if target attacking creature token is the chosen type"): the `chosen` field of a filter
 * with the link placeholder, a type of whichever kind the linked choice chose (parser/lower/links.ts resolves it, as CLOUD C5's "of the chosen type"; CR 607.2d).
 */
export const chosenType: HoleFn = (ctx, pos) => {
  const e = phraseAt(ctx, pos, W_THE_CHOSEN_TYPE);
  return e >= 0 ? [{ end: e, value: { link: '$link', quality: '$chosenType' } }] : [];
};

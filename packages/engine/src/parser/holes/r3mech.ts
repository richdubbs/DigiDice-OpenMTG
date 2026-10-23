/**
 * Cloud r3-mech: small hole grammars of its templates (parser/templates/zz-cloud/r3-mech.json).
 *
 * `SiegeWord`: one of the words a Siege chooses between as it enters ("As this enchantment enters, choose Khans or Dragons.", "... choose Abzan or Mardu."):
 * the two factions of Fate Reforged and the five clans of Tarkir: Dragonstorm. A closed list (guard G2: any other word yields no parse); these words name no
 * game object and have no rules meaning of their own, the bulleted ability labelled with the chosen word is the one the permanent has (parser/segment.ts
 * #siegeMode, CR 614.12a, 607.2d). Value: the word as printed (capitalized).
 */
import type { HoleFn } from './core';

const SIEGE_WORDS: Readonly<Record<string, string>> = {
  khans: 'Khans', dragons: 'Dragons', abzan: 'Abzan', jeskai: 'Jeskai', mardu: 'Mardu', sultai: 'Sultai', temur: 'Temur',
};

/** The words a Siege's choice may name (lower case), for parser/segment.ts. */
export const SIEGE_WORD_SET: ReadonlySet<string> = new Set(Object.keys(SIEGE_WORDS));

export const siegeWord: HoleFn = (ctx, pos) => {
  const t = ctx.toks[pos];
  if (t === undefined || t.kind !== 'WORD') return [];
  const w = SIEGE_WORDS[t.norm.toLowerCase()];
  return w === undefined ? [] : [{ end: pos + 1, value: w }];
};

/**
 * Cloud r4-mech: small hole grammars of its templates (parser/templates/zz-cloud/r4-mech.json).
 *
 * `PluralSubtype`: ONE subtype written in the plural ("Mercenaries", "Zombies"), the subtype a type-adding static gives a group ("Creatures you control but don't
 * own are Mercenaries in addition to their other types", CR 205.1b, 613.1d). Value: `[name]`, the singular name of the generated lexicon. A singular subtype, a
 * card type or any other word yields no parse (the plural forms come from the lexicon's subtype table, design 6.11).
 */
import type { HoleFn } from './core';
import { multiAt } from './core';

export const pluralSubtype: HoleFn = (ctx, pos) => multiAt(ctx, pos, ctx.vocab.subtypes).filter((m) => m.entry.plural).map((m) => ({ end: m.end, value: [m.entry.name] }));

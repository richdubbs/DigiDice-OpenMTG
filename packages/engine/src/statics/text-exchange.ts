/**
 * edh-next-120 (CR 612.5, 701.12h, 613.1c; Deadpool, Trading Card): the layer 3 part of an exchange of text boxes. The affected object's rules text (its abilities that are text of
 * the object: origin printed, keyword expansions, copied; CR 612.3: granted abilities and the abilities the rules give are not text and stay) is replaced by the rules text of the
 * snapshot the effect's record carries (`ContinuousEffectRec.textOf`: the other object's copiable values as the exchange began, so "the previous rules text of the other", CR 701.12h).
 * The abilities given are keyed under the effect (`c:<effectId>:...`, as a copy effect's) with their links in the effect's namespace. Everything else of the object (name, mana cost,
 * types, power, toughness) is not text of the text box and stays. No snapshot: nothing changes (fail closed; such a record is never written).
 *
 * Import rules (m6 design 4.4): GameState-level and pure; statics value-imports statics only.
 */
import type { Chars } from '../rules/characteristics';
import type { GameState } from '../types/state';
import type { ObjectId } from '../types/ids';
import { keywordsOfAbilities } from './abilities';
import type { CharAbility, ModContext } from './api';
import { applyCopiable } from './copy';

/** The origins of the abilities that are rules text of the object (statics/text-change.ts#TEXT_ORIGINS, CR 612.3). */
const TEXT_ORIGINS: ReadonlySet<CharAbility['origin']> = new Set(['printed', 'keyword', 'copied']);

export function applyRulesTextOf(c: Chars, subject: ObjectId, s: GameState, all: ReadonlyMap<ObjectId, Chars>, fx: ModContext | undefined): Chars {
  if (fx?.textOf === undefined) return c;
  const from = applyCopiable({ ...c, abilities: [], keywords: [] }, fx.textOf, subject, s, all, fx.id);
  const kept = c.abilities.filter((a) => !TEXT_ORIGINS.has(a.origin));
  const given = from.abilities.filter((a) => TEXT_ORIGINS.has(a.origin));
  const abilities = [...given, ...kept];
  return { ...c, abilities, keywords: keywordsOfAbilities(abilities) };
}

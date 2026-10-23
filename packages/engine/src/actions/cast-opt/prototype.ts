/**
 * Casting prototyped (CR 718.3, 702.160; m6 design 3.7). Owner: M6-6.
 *
 * A card with the prototype keyword and the alternative characteristics of its inset frame (`FaceDef.prototype`, cards/faces.ts) may be cast as the method
 * `prototype`. It is not an alternative cost (CR 118.9): the spell's mana cost IS the prototype's (CR 718.3b), so the cost paid is that mana cost (`cost`: null,
 * the normal cost of the overridden characteristics; cost modifiers apply to it, CR 601.2f), and "without paying its mana cost" would pay nothing. From the
 * moment it is announced the spell has only the prototype's mana cost, power and toughness and the colors of that cost (CR 718.3a-b): `charsOverride`, which
 * actions/cast.ts#castCheck applies before the timing and prohibition checks, so they are judged on it. `onStack` marks it prototyped; the permanent it becomes
 * stays prototyped (core/move-parts/prototype.ts) and has the same characteristics (rules/base-parts/prototype.ts).
 *
 * From the hand, and a commander from the command zone (CMDF, CR 903.8: the tax applies and the cast is counted; cast-opt/zones.ts). An effect that lets a
 * player cast a card from another zone does not offer this choice yet (the card can still be cast normally there).
 */
import { charsOfObject } from '../../rules/characteristics';
import { prototypeChars } from '../../rules/base-parts/prototype';
import type { CastOptionProvider } from '../cast-options';
import { castableFromHandOrCommand } from './zones';

export const PROTOTYPE_CAST_OPTIONS: readonly CastOptionProvider[] = [
  {
    name: 'prototype',
    offers: (g, o, player) => {
      if (!castableFromHandOrCommand(g, o, player)) return false;
      const def = g.s.defs[o.defId];
      return def?.faces[0]?.prototype !== undefined && charsOfObject(g.s, o).keywords.some((k) => k.keyword === 'prototype');
    },
    cost: () => null,
    charsOverride: (def, face) => prototypeChars(def, face) ?? prototypeChars(def, 0)!,
    onStack: (_g, spell) => {
      spell.prototyped = true; // CR 718.3b
    },
  },
];

/**
 * Casting a mutating creature spell (CR 702.140a; m6 design 3.7). Owner: M6-9.
 *
 * "Mutate [cost]" means "You may pay [cost] rather than pay this spell's mana cost. If you do, it becomes a mutating creature spell and targets a non-Human
 * creature with the same owner as this spell." The method `mutate` is offered for a card with mutate in its owner's hand (the zone a spell is cast from
 * without permission, CR 601.3); its cost is the mutate cost (an alternative cost, CR 118.9, 601.2b, 601.2f-h); the spell keeps the card's characteristics;
 * its target (rules/merge.ts#MUTATE_TARGET) is announced with the spell's own (CR 601.2c). What happens as it resolves is core/resolve-parts/mutate.ts.
 *
 * From the hand, and a commander from the command zone (CMDF, CR 903.8: the tax applies, the cast is counted; the merged permanent is the commander, CR
 * 903.3c; cast-opt/zones.ts). An effect that lets a player cast a card from another zone does not offer the method yet.
 */
import type { CardDef } from '../../types/card';
import type { CostDef } from '../../types/ability';
import { faceChars } from '../../rules/characteristics';
import { MUTATE_METHOD, MUTATE_TARGET } from '../../rules/merge';
import type { CastOptionProvider } from '../cast-options';
import { castableFromHandOrCommand } from './zones';

/** The mutate cost printed on the card's front face (CR 702.140a), or null. */
export function mutateCost(def: CardDef | undefined): CostDef | null {
  if (!def || def.faces.length === 0) return null;
  return faceChars(def, 0).keywords.find((k) => k.keyword === 'mutate')?.cost ?? null;
}

export const MUTATE_CAST_OPTIONS: readonly CastOptionProvider[] = [
  {
    name: MUTATE_METHOD,
    offers: (g, o, player) => castableFromHandOrCommand(g, o, player) && mutateCost(g.s.defs[o.defId]) !== null,
    cost: (g, o) => mutateCost(g.s.defs[o.defId]),
    extraTargets: () => [MUTATE_TARGET], // CR 702.140a
    // CR 702.140a: it is a mutating creature spell because it was cast for its mutate cost (StackInfo.costsPaid.alternative: rules/merge.ts#isMutating)
    onStack: () => undefined,
  },
];

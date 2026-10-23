/**
 * Casting a foretold card (CR 702.143a). Owner: cloud r3-mech.
 *
 * "Foretell [cost]" ends "Cast it on a later turn for its foretell cost": a foretold card's owner may cast it from exile, after the turn in which it was
 * foretold, by paying its foretell cost rather than its mana cost (an alternative cost, CR 118.9: additional costs are still paid, CR 118.9d; cost changes
 * apply to the total, CR 601.2f). The method `foretell` is offered for a foretold card in exile (core/special/foretell.ts#foretoldTurn) to its owner on a later
 * turn; the card's normal timing applies (CR 702.143a states none: an instant may be cast any time its owner could cast an instant). The foretell cost is the
 * one printed on the card (the face-down card in exile has no characteristics of its own, CR 708.2; the cost is read from the card's front face, as the spell
 * it becomes, CR 601.3e). A card with two different foretell costs is not offered (no printed card has two; fail closed). Every other check of casting is the
 * cast path's; the spell is cast face up (CR 601.2a: it is put onto the stack as itself).
 */
import { foretoldTurn } from '../../core/special/foretell';
import type { CostDef } from '../../types/ability';
import type { CardDef } from '../../types/card';
import type { CastOptionProvider } from '../cast-options';

/** The foretell cost printed on the card's front face, or null (none, or two different ones). */
export function foretellCostOf(def: CardDef | undefined): CostDef | null {
  const face = def?.faces[0];
  if (face === undefined) return null;
  const costs = face.abilities.flatMap((a) => (a.kind === 'keyword' && a.keyword === 'foretell' && a.cost !== undefined ? [a.cost] : []));
  if (costs.length === 0) return null;
  const first = JSON.stringify(costs[0]);
  return costs.every((c) => JSON.stringify(c) === first) ? costs[0]! : null;
}

export const FORETELL_CAST_OPTIONS: readonly CastOptionProvider[] = [
  {
    name: 'foretell',
    offers: (g, o, player) => {
      const t = foretoldTurn(o);
      return t !== undefined && o.owner === player && g.s.turn.number > t && foretellCostOf(g.s.defs[o.defId]) !== null;
    },
    cost: (g, o) => foretellCostOf(g.s.defs[o.defId]),
    onStack: () => {},
  },
];

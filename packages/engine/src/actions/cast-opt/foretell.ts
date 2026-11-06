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
import { FORETELL_LESS_KEY, foretoldTurn } from '../../core/special/foretell';
import type { ManaCost } from '../../types/mana';
import type { GameObject } from '../../types/state';
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

/** edh-d-73 (CR 702.143a, 107.4; Dream Devourer ruling 2021-02-05): the mana cost with `less` generic mana taken off (only generic mana, never below none), the foretell cost a granted foretell gave the card. */
export function reducedManaCost(cost: ManaCost, less: number): ManaCost {
  const generic = cost.reduce((n, x) => n + (x.kind === 'generic' ? x.amount : 0), 0);
  const rest = cost.filter((x) => x.kind !== 'generic');
  const left = Math.max(0, generic - less);
  return left > 0 ? [{ kind: 'generic', amount: left }, ...rest] : rest;
}

/** The cost a foretold card is cast for: the printed foretell cost, or the one a granted foretell gave it (kept on the card when it was foretold). */
export function foretoldCostOf(g: { s: { defs: Record<string, CardDef | undefined> } }, o: GameObject): CostDef | null {
  const def = g.s.defs[o.defId];
  const printed = foretellCostOf(def);
  if (printed !== null) return printed;
  const less = o.chosen?.[FORETELL_LESS_KEY];
  const mana = def?.faces[0]?.manaCost ?? null;
  return typeof less === 'number' && mana !== null ? { mana: reducedManaCost(mana, less) } : null;
}

export const FORETELL_CAST_OPTIONS: readonly CastOptionProvider[] = [
  {
    name: 'foretell',
    offers: (g, o, player) => {
      const t = foretoldTurn(o);
      return t !== undefined && o.owner === player && g.s.turn.number > t && foretoldCostOf(g, o) !== null;
    },
    cost: (g, o) => foretoldCostOf(g, o),
    onStack: () => {},
  },
  // edh-d-86 (CR 702.143a, 118.9; Ethereal Valkyrie ruling 2021-02-05): a card with a printed foretell cost that an effect foretold with "its foretell cost is its mana cost reduced by
  // {2}" has two foretell costs, and its owner may cast it for either: the printed one above, the one the effect gave here (only when it is another cost)
  {
    name: 'foretell:granted', // the prefix keeps "if this spell was foretold" true for it (effects/eval.ts reads `<via>:`, CR 702.143c)
    offers: (g, o, player) => {
      const t = foretoldTurn(o);
      const other = grantedForetellCost(g, o);
      return t !== undefined && o.owner === player && g.s.turn.number > t && other !== null && JSON.stringify(other) !== JSON.stringify(foretellCostOf(g.s.defs[o.defId]));
    },
    cost: (g, o) => grantedForetellCost(g, o),
    onStack: () => {},
  },
];

/** edh-d-86: the foretell cost an effect gave a card that also prints one (its mana cost with generic mana taken off, kept on the foretold card), or null. */
function grantedForetellCost(g: { s: { defs: Record<string, CardDef | undefined> } }, o: GameObject): CostDef | null {
  const def = g.s.defs[o.defId];
  if (foretellCostOf(def) === null) return null; // no printed cost: foretoldCostOf already offers the granted one under 'foretell'
  const less = o.chosen?.[FORETELL_LESS_KEY];
  const mana = def?.faces[0]?.manaCost ?? null;
  return typeof less === 'number' && mana !== null ? { mana: reducedManaCost(mana, less) } : null;
}

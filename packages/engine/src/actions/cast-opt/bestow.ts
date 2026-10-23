/**
 * Casting a card for its bestow cost (CR 702.103a-b; std-ry7, cites written from memory in a cloud session, unverified).
 *
 * "Bestow [cost]" means "You may cast this card by paying [cost] rather than its mana cost" and "If you chose to pay this spell's bestow cost, it becomes an Aura
 * enchantment and gains enchant creature" (CR 702.103a). The method `bestow` is offered for a card with bestow in its owner's hand (the zone a spell is cast
 * from without permission, CR 601.3) or a commander in the command zone; its cost is the bestow cost (an alternative cost, CR 118.9, 601.2b, 601.2f-h). From the
 * moment it is announced the spell has the bestowed characteristics (`charsOverride`, rules/base-parts/bestow.ts), so it is an Aura spell that targets the
 * creature it will enchant (CR 303.4a, 601.2c) and its timing and the "can't cast" checks are judged on them. `onStack` marks it bestowed; the permanent stays
 * bestowed (core/move-parts/bestow.ts). An effect that lets a player cast the card from another zone does not offer the method yet.
 * p2-graveyard-1 (CR 601.3, 113.6f): "You may cast this card from your graveyard using its bestow ability" (a `castWith` static of the card's own, method
 * `bestow`, from the graveyard) offers the method for the card in its owner's graveyard too, with the same cost and characteristics.
 */
import type { CardDef } from '../../types/card';
import type { CostDef } from '../../types/ability';
import { faceChars } from '../../rules/characteristics';
import { bestowedChars } from '../../rules/base-parts/bestow';
import { fromFace } from '../../rules/base-chars';
import type { CastOptionProvider } from '../cast-options';
import { castableFromHandOrCommand } from './zones';
import type { GameObject } from '../../types/state';
import type { PlayerId } from '../../types/ids';

/** The bestow cost printed on the card's front face (CR 702.103a), or null. */
export function bestowCost(def: CardDef | undefined): CostDef | null {
  if (!def || def.faces.length !== 1) return null;
  return faceChars(def, 0).keywords.find((k) => k.keyword === 'bestow')?.cost ?? null;
}

/** p2-graveyard-1 (CR 601.3, 113.6f): the face-up card is in its owner's graveyard and its own text lets it be cast from there using its bestow ability. */
function bestowFromGraveyard(def: CardDef | undefined, o: GameObject, player: PlayerId): boolean {
  if (!def || def.faces.length !== 1 || o.zone !== 'graveyard' || o.owner !== player || o.kind !== 'card' || o.faceDown) return false;
  return faceChars(def, 0).abilities.some((a) => a.def.kind === 'static' && a.def.effects.some((e) => e.s === 'castWith' && e.method === 'bestow' && e.from === 'graveyard'));
}

export const BESTOW_CAST_OPTIONS: readonly CastOptionProvider[] = [
  {
    name: 'bestow',
    offers: (g, o, player) => (castableFromHandOrCommand(g, o, player) || bestowFromGraveyard(g.s.defs[o.defId], o, player)) && bestowCost(g.s.defs[o.defId]) !== null && bestowedChars(g.s.defs[o.defId]!, 0) !== null,
    cost: (g, o) => bestowCost(g.s.defs[o.defId]),
    // asked before `offers` (actions/cast.ts#castCheck): a card that is no creature keeps its own characteristics and is then refused by `offers`
    charsOverride: (def) => bestowedChars(def, 0) ?? fromFace(def.faces[0]!, 0),
    onStack: (_g, spell) => {
      spell.bestowed = true; // CR 702.103b
    },
  },
];

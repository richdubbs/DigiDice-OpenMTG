/**
 * Foretell, the special action (CR 702.143a-b, 116.2h). Owner: cloud r3-mech.
 *
 * "Foretell [cost]" means "Any time you have priority during your turn, you may pay {2} and exile this card from your hand face down. Cast it on a later turn
 * for its foretell cost." (CR 702.143a); exiling the card this way is a special action (CR 702.143b, 116.2h: "any time they have priority during their own
 * turn"). Listed (core/legal.ts, for the player with priority) for each card with foretell in the player's hand during that player's own turn when {2} can be
 * paid now. Performing it pays {2} (cancellable decisions, CR 733.1), exiles the card face down and makes the exiled card foretold: `chosen.foretold` holds the
 * turn number it was foretold (the object in exile: a new object if it leaves exile, CR 400.7). Its owner may look at it (CR 406.3: `revealedTo`); nobody else
 * may. A foretold card is cast by actions/cast-opt/foretell.ts (CR 702.143a: "on a later turn", for its foretell cost).
 *
 * Not here (fail closed): effects that foretell a card or let a player foretell from another zone, "foretold cards cost less", and triggers on foretelling
 * ("whenever you foretell a card") are not implemented, so the cards that say so stay manual.
 *
 * The payment and the zone change are performed by effects/handlers/foretell-ops.ts, which installs itself here when it loads (an import cycle otherwise, as
 * core/special/plot.ts).
 */
import type { CostDef } from '../../types/ability';
import type { ObjectId, PlayerId } from '../../types/ids';
import type { GameObject, GameState } from '../../types/state';
import { charsOfObject } from '../../rules/characteristics';
import { IllegalAction, type Game } from '../game';
import type { SpecialActionHandler } from '../registries';

/** The `chosen` key of the foretold designation: the turn number in which the card was foretold (CR 702.143a). */
export const FORETOLD_KEY = 'foretold';

/** CR 702.143a: the cost of the special action, {2}, whatever the card's foretell cost. */
export const FORETELL_ACTION_COST: CostDef = { mana: [{ kind: 'generic', amount: 2 }] };

/** The turn in which this card in exile was foretold, or undefined when it is not a foretold card (CR 702.143a). Pure. */
export function foretoldTurn(o: GameObject): number | undefined {
  const t = o.zone === 'exile' && o.kind === 'card' ? o.chosen?.[FORETOLD_KEY] : undefined;
  return typeof t === 'number' ? t : undefined;
}

/** What performs the action (installed by effects/handlers/foretell-ops.ts, see the file comment). */
export interface ForetellImpl {
  /** Could `player` pay {2} now for this special action (CR 118.3)? */
  payable(s: GameState, player: PlayerId, id: ObjectId): boolean;
  /** Pay {2} (cancellable decisions, CR 733.1), exile the card from the hand face down and make it foretold (CR 702.143a). */
  perform(g: Game, player: PlayerId, id: ObjectId): void;
}
let impl: ForetellImpl | null = null;
export function installForetell(f: ForetellImpl | null): void {
  impl = f;
}

/**
 * Does the card, as it is in the hand (its characteristics), have foretell (CR 702.143a), and does its front face print a foretell cost? The foretold card
 * is cast for the printed cost (actions/cast-opt/foretell.ts#foretellCostOf); foretell granted by another object ("Each nonland card in your hand without
 * foretell has foretell. Its foretell cost is ...", Dream Devourer) has no printed cost to cast it for, so it is not offered (fail closed: never exile a card
 * that then can't be cast).
 */
const hasForetell = (s: GameState, o: GameObject): boolean => charsOfObject(s, o).keywords.some((k) => k.keyword === 'foretell')
  && (s.defs[o.defId]?.faces[0]?.abilities ?? []).some((a) => a.kind === 'keyword' && a.keyword === 'foretell' && a.cost !== undefined);

function listed(g: Game, player: PlayerId): { object: ObjectId; label: string; cost: CostDef }[] {
  if (!impl) return []; // fail closed: nothing to perform it with
  const s = g.s;
  if (s.turn.activePlayer !== player) return []; // CR 702.143a, 116.2h: during your own turn (and you have priority: core/legal.ts lists for the player who has it)
  const out: { object: ObjectId; label: string; cost: CostDef }[] = [];
  for (const id of s.zones.hand[player] ?? []) {
    const o = s.objects[id];
    if (!o || o.kind !== 'card' || o.owner !== player || !hasForetell(s, o) || !impl.payable(s, player, id)) continue;
    out.push({ object: id, label: `Foretell ${charsOfObject(s, o).name} ({2})`, cost: FORETELL_ACTION_COST });
  }
  return out;
}

export const FORETELL_HANDLERS: readonly SpecialActionHandler[] = [
  {
    kind: 'foretell',
    list: (g, player) => listed(g, player),
    perform: (g, action) => {
      const pick = action.object === undefined ? undefined : listed(g, action.player).find((x) => x.object === action.object);
      if (!pick) throw new IllegalAction("That card can't be foretold now.", ['CR 116.1', 'CR 116.2h', 'CR 702.143a']);
      impl!.perform(g, action.player, pick.object);
    },
  },
];
